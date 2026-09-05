import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  COMMAND_STORAGE,
  EVENT_STORAGE,
  MESSAGE_STORAGE,
  VOLUME_STORAGE,
  createTvChannel,
  type TvCommand,
  type TvEvent,
  type TvMessage,
} from "@/lib/tv-channel";

export const Route = createFileRoute("/player")({
  head: () => ({
    meta: [
      { title: "Pantalla TV — Salida de Video Karaoke" },
      {
        name: "description",
        content:
          "Salida limpia a pantalla completa para TV: reproduce la cola de karaoke con un reproductor persistente sin cortes.",
      },
      { property: "og:title", content: "Pantalla TV — Salida de Video Karaoke" },
      {
        property: "og:description",
        content: "Pantalla de reproducción limpia para karaoke, controlada en tiempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlayerScreen,
});

/** Segundos restantes a partir de los cuales se recorta el silencio final. */
const TAIL_TRIM_SECONDS = 3;

type YtPlayer = {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  unMute: () => void;
  mute: () => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YtPlayer;
      PlayerState: Record<string, number>;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function readCommand(): TvCommand | null {
  try {
    const raw = window.localStorage.getItem(COMMAND_STORAGE);
    return raw ? (JSON.parse(raw) as TvCommand) : null;
  } catch {
    return null;
  }
}

function readStoredMessage(): string {
  try {
    const raw = window.localStorage.getItem(MESSAGE_STORAGE);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return "";
  }
}

/** Carga (una sola vez) la API de iframes de YouTube. */
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve();
      }
    }, 200);
  });
}

function PlayerScreen() {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const readyRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastCommandTsRef = useRef(0);
  const targetVolumeRef = useRef(80);
  const currentRef = useRef<{ videoId: string; title: string }>({
    videoId: "",
    title: "",
  });
  const pendingRef = useRef<{ videoId: string; title: string } | null>(null);
  const endedSentRef = useRef(false);
  const bufferingSinceRef = useRef(0);
  const progressRef = useRef({ duration: 0, currentTime: 0, playing: false });

  const [hasVideo, setHasVideo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [requester, setRequester] = useState<string | null>(null);
  const [needsAudioClick, setNeedsAudioClick] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const requesterTimerRef = useRef<number | null>(null);

  /** Escribe un evento para la consola (funciona entre ventanas vía localStorage). */
  const writeEvent = useCallback(
    (
      kind: TvEvent["kind"],
      extra?: { code?: number; title?: string; videoId?: string },
    ) => {
      try {
        window.localStorage.setItem(
          EVENT_STORAGE,
          JSON.stringify({
            kind,
            deck: "A",
            duration: progressRef.current.duration,
            currentTime: progressRef.current.currentTime,
            playing: progressRef.current.playing,
            timestamp: Date.now(),
            ...extra,
          } satisfies TvEvent),
        );
      } catch {
        /* almacenamiento no disponible */
      }
    },
    [],
  );

  /** Reproduce una pista nueva sobre la instancia existente. */
  const playTrack = useCallback((videoId: string, title: string) => {
    currentRef.current = { videoId, title };
    endedSentRef.current = false;
    bufferingSinceRef.current = 0;
    progressRef.current = { duration: 0, currentTime: 0, playing: false };
    setHasVideo(true);
    setLoading(true);
    const player = playerRef.current;
    if (!player || !readyRef.current) {
      pendingRef.current = { videoId, title };
      return;
    }
    try {
      player.loadVideoById({ videoId, startSeconds: 0 });
      player.setVolume(targetVolumeRef.current);
      player.unMute();
      player.playVideo();
    } catch {
      pendingRef.current = { videoId, title };
    }
  }, []);

  const applyCommand = useCallback(
    (cmd: TvCommand) => {
      if (cmd.timestamp <= lastCommandTsRef.current) return;
      lastCommandTsRef.current = cmd.timestamp;
      const player = playerRef.current;

      switch (cmd.action) {
        case "PLAY": {
          if (cmd.videoId && cmd.videoId !== currentRef.current.videoId) {
            playTrack(cmd.videoId, cmd.title ?? "");
            if (requesterTimerRef.current) window.clearTimeout(requesterTimerRef.current);
            if (cmd.requester) {
              setRequester(cmd.requester);
              requesterTimerRef.current = window.setTimeout(
                () => setRequester(null),
                8000,
              );
            } else {
              setRequester(null);
            }
          } else {
            player?.playVideo();
          }
          break;
        }
        case "PAUSE":
          player?.pauseVideo();
          break;
        case "RESTART":
          player?.seekTo(0, true);
          player?.playVideo();
          break;
        case "SEEK_TO":
          player?.seekTo(Math.max(0, cmd.seconds), true);
          player?.playVideo();
          break;
        case "MESSAGE":
          setMessage(cmd.text);
          break;
        case "CLEAR":
          currentRef.current = { videoId: "", title: "" };
          pendingRef.current = null;
          progressRef.current = { duration: 0, currentTime: 0, playing: false };
          try {
            player?.stopVideo();
          } catch {
            /* aún sin reproductor */
          }
          setHasVideo(false);
          setLoading(false);
          break;
      }
    },
    [playTrack],
  );

  const applyCommandRef = useRef(applyCommand);
  applyCommandRef.current = applyCommand;

  /** Falla la pista actual: avisa al panel y libera la pantalla al instante. */
  const failCurrent = useCallback(
    (code: number) => {
      const { videoId, title } = currentRef.current;
      if (endedSentRef.current) return;
      endedSentRef.current = true;
      setLoading(false);
      writeEvent("embed_error", { code, title: title || videoId, videoId });
      channelRef.current?.postMessage({
        type: "embed_error",
        videoId,
        title: title || videoId,
        code,
      } satisfies TvMessage);
    },
    [writeEvent],
  );

  // --- Montaje único del reproductor persistente ---
  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        width: "100%",
        height: "100%",
        videoId: "",
        playerVars: {
          autoplay: 1,
          controls: 0,
          rel: 0,
          enablejsapi: 1,
          modestbranding: 1,
          iv_load_policy: 3,
          fs: 0,
          disablekb: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current?.setVolume(targetVolumeRef.current);
            const pending = pendingRef.current;
            if (pending) {
              pendingRef.current = null;
              playTrack(pending.videoId, pending.title);
            }
          },
          onStateChange: (e: { data: number }) => {
            const state = e.data;
            if (state === 1) {
              // PLAYING
              setLoading(false);
              setNeedsAudioClick(false);
              bufferingSinceRef.current = 0;
              progressRef.current.playing = true;
              endedSentRef.current = false;
            } else if (state === 3) {
              // BUFFERING
              if (!bufferingSinceRef.current) bufferingSinceRef.current = Date.now();
              progressRef.current.playing = false;
            } else if (state === 0) {
              // ENDED
              progressRef.current.playing = false;
              if (!endedSentRef.current && currentRef.current.videoId) {
                endedSentRef.current = true;
                writeEvent("ended");
              }
            } else {
              progressRef.current.playing = false;
            }
          },
          onError: (e: { data: number }) => {
            failCurrent(e.data);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ya destruido */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateAudio = () => {
    playerRef.current?.unMute();
    playerRef.current?.setVolume(targetVolumeRef.current);
    playerRef.current?.playVideo();
    setNeedsAudioClick(false);
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // Ocultar el botón flotante tras 2 s sin mover el mouse
  useEffect(() => {
    let timer = window.setTimeout(() => setControlsVisible(false), 2000);
    const onMove = () => {
      setControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 2000);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onMove);
    };
  }, []);

  // Fondo negro persistente + sin scroll ni márgenes
  useEffect(() => {
    const html = document.documentElement;
    html.style.overflow = "hidden";
    html.style.margin = "0";
    html.style.padding = "0";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.maxWidth = "100%";
    document.body.style.maxHeight = "100%";
    document.body.style.backgroundColor = "#000";
    return () => {
      html.style.overflow = "";
      html.style.margin = "";
      html.style.padding = "";
      document.body.style.overflow = "";
      document.body.style.margin = "";
      document.body.style.padding = "";
      document.body.style.maxWidth = "";
      document.body.style.maxHeight = "";
      document.body.style.backgroundColor = "";
    };
  }, []);

  // Sincronización con la consola + latido de estado
  useEffect(() => {
    const savedVolume = window.localStorage.getItem(VOLUME_STORAGE);
    if (savedVolume != null) {
      const v = Number(savedVolume);
      if (Number.isFinite(v)) targetVolumeRef.current = v;
    }

    const last = readCommand();
    if (last) applyCommandRef.current(last);

    const onStorage = (e: StorageEvent) => {
      if (e.key === COMMAND_STORAGE && e.newValue) {
        try {
          applyCommandRef.current(JSON.parse(e.newValue) as TvCommand);
        } catch {
          /* json inválido */
        }
      }
      if (e.key === VOLUME_STORAGE && e.newValue != null) {
        const v = Number(e.newValue);
        if (Number.isFinite(v)) {
          targetVolumeRef.current = v;
          playerRef.current?.setVolume(v);
        }
      }
      if (e.key === MESSAGE_STORAGE) setMessage(readStoredMessage());
    };
    setMessage(readStoredMessage());
    window.addEventListener("storage", onStorage);

    const channel = createTvChannel();
    channelRef.current = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent<TvMessage>) => {
        const data = event.data;
        switch (data.type) {
          case "play_video":
            applyCommandRef.current({
              action: "PLAY",
              videoId: data.videoId,
              title: data.title,
              ...(data.requester ? { requester: data.requester } : {}),
              ...(data.requestType ? { requestType: data.requestType } : {}),
              timestamp: Date.now(),
            });
            break;
          case "play":
            playerRef.current?.playVideo();
            break;
          case "pause":
            playerRef.current?.pauseVideo();
            break;
          case "restart":
            playerRef.current?.seekTo(0, true);
            playerRef.current?.playVideo();
            break;
          case "seek":
            playerRef.current?.seekTo(Math.max(0, data.seconds), true);
            playerRef.current?.playVideo();
            break;
          case "volume":
            targetVolumeRef.current = data.volume;
            playerRef.current?.setVolume(data.volume);
            break;
          case "message":
            setMessage(data.text);
            break;
          case "clear":
            applyCommandRef.current({ action: "CLEAR", timestamp: Date.now() });
            break;
          default:
            break;
        }
      };
    }

    const interval = window.setInterval(() => {
      setMessage((prev) => {
        const stored = readStoredMessage();
        return stored === prev ? prev : stored;
      });

      const player = playerRef.current;
      if (player && readyRef.current && currentRef.current.videoId) {
        try {
          const duration = player.getDuration() || 0;
          const currentTime = player.getCurrentTime() || 0;
          const state = player.getPlayerState();
          if (duration > 1) progressRef.current.duration = duration;
          if (currentTime >= 0) progressRef.current.currentTime = currentTime;
          progressRef.current.playing = state === 1;

          // Buffering atascado más de 6 s: forzar reproducción.
          if (state === 3) {
            if (!bufferingSinceRef.current) bufferingSinceRef.current = Date.now();
            else if (Date.now() - bufferingSinceRef.current > 6000) {
              bufferingSinceRef.current = Date.now();
              player.playVideo();
            }
          } else {
            bufferingSinceRef.current = 0;
          }

          // Recorte del silencio final.
          if (
            duration > 5 &&
            duration - currentTime <= TAIL_TRIM_SECONDS &&
            !endedSentRef.current
          ) {
            endedSentRef.current = true;
            writeEvent("ended");
          }
        } catch {
          /* reproductor no listo */
        }
      }

      writeEvent("heartbeat");
      channelRef.current?.postMessage({
        type: "state",
        duration: progressRef.current.duration,
        currentTime: progressRef.current.currentTime,
        playing: progressRef.current.playing,
        deck: "A",
      } satisfies TvMessage);
    }, 500);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
      channelRef.current = null;
    };
  }, [writeEvent]);

  return (
    <div className="fixed inset-0 m-0 flex h-screen w-screen items-center justify-center overflow-hidden bg-black p-0">
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="relative overflow-hidden"
          style={{
            aspectRatio: "16 / 9",
            width: "min(100%, calc(100vh * 16 / 9))",
            height: "auto",
            maxHeight: "100%",
          }}
        >
          <div
            ref={hostRef}
            className="pointer-events-none absolute inset-0 h-full w-full border-none bg-black opacity-100"
          />
        </div>
      </div>

      {/* Velo de carga: solo existe mientras el video arranca. */}
      {hasVideo && loading && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black" />
      )}

      {needsAudioClick && (
        <button
          type="button"
          onClick={activateAudio}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80 text-white"
        >
          <span className="rounded-full border border-white/30 px-8 py-4 text-lg font-semibold tracking-wide">
            ▶ Activar audio y reproducir
          </span>
          <span className="text-sm text-white/50">
            El navegador bloqueó la reproducción automática — toca para empezar
          </span>
        </button>
      )}

      {!hasVideo && (
        <div className="absolute inset-0 z-10 overflow-hidden">
          <div className="tv-idle-bg absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="animate-fade-in text-lg uppercase tracking-[0.4em] text-white/60 md:text-2xl">
              En breve más música...
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label="Pantalla completa"
        className={`absolute bottom-6 right-6 z-30 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-xs uppercase tracking-widest text-white/70 transition-opacity duration-500 hover:text-white ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        ⛶ Pantalla completa
      </button>

      {requester && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-6 pt-6 md:pt-10">
          <div className="tv-ticker rounded-2xl border border-primary/40 bg-black/70 px-8 py-4 md:px-12 md:py-5">
            <p className="text-center text-2xl font-bold text-white drop-shadow-lg md:text-4xl">
              {`🎵 Petición de: ${requester}`}
            </p>
          </div>
        </div>
      )}


      {message && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-6">
          <p className="rounded-full bg-black/75 px-8 py-4 text-3xl font-bold text-white drop-shadow-lg md:text-5xl">
            {message}
          </p>
        </div>
      )}
    </div>
  );
}
