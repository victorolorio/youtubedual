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
          "Salida limpia a pantalla completa para TV: reproduce la cola de karaoke controlada desde la consola DJ.",
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

const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";


function readCommand(): TvCommand | null {
  try {
    const raw = window.localStorage.getItem(COMMAND_STORAGE);
    return raw ? (JSON.parse(raw) as TvCommand) : null;
  } catch {
    return null;
  }
}

/** Lee el mensaje en pantalla guardado por la consola. */
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

function PlayerScreen() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastCommandTsRef = useRef(0);
  const videoIdRef = useRef("");
  const titleRef = useRef("");
  const progressRef = useRef({ duration: 0, currentTime: 0, playing: false });
  const endedSentRef = useRef(false);

  /** Escribe un evento para la consola (funciona entre ventanas vía localStorage). */
  const writeEvent = useCallback((kind: TvEvent["kind"], extra?: { code?: number; title?: string }) => {
    try {
      window.localStorage.setItem(
        EVENT_STORAGE,
        JSON.stringify({
          kind,
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
  }, []);



  const [videoId, setVideoId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [needsAudioClick, setNeedsAudioClick] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);

  /** Enviar un comando a la API del iframe (playVideo, pauseVideo, setVolume...). */
  const sendIframeCommand = useCallback((func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }, []);

  const applyCommand = useCallback(
    (cmd: TvCommand) => {
      if (cmd.timestamp <= lastCommandTsRef.current) return;
      lastCommandTsRef.current = cmd.timestamp;

      switch (cmd.action) {
        case "PLAY": {
          if (cmd.videoId && cmd.videoId !== videoIdRef.current) {
            videoIdRef.current = cmd.videoId;
            titleRef.current = cmd.title ?? "";
            endedSentRef.current = false;
            setVideoId(cmd.videoId);
            setTitle(cmd.title ?? "");
            setEmbedError(null);

          } else {
            // Mismo video: reanudar
            sendIframeCommand("playVideo");
          }
          break;
        }
        case "PAUSE":
          sendIframeCommand("pauseVideo");
          break;
        case "RESTART":
          sendIframeCommand("seekTo", [0, true]);
          sendIframeCommand("playVideo");
          break;
        case "MESSAGE":
          setMessage(cmd.text);
          break;
        case "CLEAR":
          sendIframeCommand("pauseVideo");
          videoIdRef.current = "";
          titleRef.current = "";
          setVideoId("");
          setTitle("");
          break;

      }
    },
    [sendIframeCommand],
  );

  const activateAudio = () => {
    sendIframeCommand("unMute");
    sendIframeCommand("playVideo");
    setNeedsAudioClick(false);
  };

  // Fondo negro persistente
  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.body.style.backgroundColor = "#000";
    return () => {
      document.body.style.overflow = "";
      document.body.style.backgroundColor = "";
    };
  }, []);

  // Sincronización dual: evento 'storage' (principal) + BroadcastChannel (respaldo)
  useEffect(() => {
    // 1) Al cargar: reproducir inmediatamente el último comando guardado
    const last = readCommand();
    if (last) applyCommand(last);
    const savedVolume = window.localStorage.getItem(VOLUME_STORAGE);
    if (savedVolume) {
      const v = Number(savedVolume);
      if (Number.isFinite(v)) {
        // El iframe aún no existe en el primer render; se aplica tras montar
        window.setTimeout(() => sendIframeCommand("setVolume", [v]), 2000);
      }
    }

    // 2) Listener global de localStorage entre pestañas/ventanas
    const onStorage = (e: StorageEvent) => {
      if (e.key === COMMAND_STORAGE && e.newValue) {
        try {
          applyCommand(JSON.parse(e.newValue) as TvCommand);
        } catch {
          /* json inválido */
        }
      }
      if (e.key === VOLUME_STORAGE && e.newValue != null) {
        const v = Number(e.newValue);
        if (Number.isFinite(v)) sendIframeCommand("setVolume", [v]);
      }
      if (e.key === MESSAGE_STORAGE) {
        setMessage(readStoredMessage());
      }
    };
    setMessage(readStoredMessage());
    window.addEventListener("storage", onStorage);

    // 3) Respaldo por BroadcastChannel (mensajes del panel)
    const channel = createTvChannel();
    channelRef.current = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent<TvMessage>) => {
        const data = event.data;
        switch (data.type) {
          case "play_video":
            applyCommand({
              action: "PLAY",
              videoId: data.videoId,
              title: data.title,
              timestamp: Date.now(),
            });
            break;
          case "play":
            sendIframeCommand("playVideo");
            break;
          case "pause":
            sendIframeCommand("pauseVideo");
            break;
          case "restart":
            sendIframeCommand("seekTo", [0, true]);
            sendIframeCommand("playVideo");
            break;
          case "volume":
            sendIframeCommand("setVolume", [data.volume]);
            break;
          case "message":
            setMessage(data.text);
            break;
          case "clear":
            applyCommand({ action: "CLEAR", timestamp: Date.now() });
            break;
          default:
            break;
        }
      };
    }

    // 4) Escuchar mensajes del iframe de YouTube (progreso, estado, errores)
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin !== "string" || !e.origin.includes("youtube.com")) return;
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data) as {
          event?: string;
          info?: {
            currentTime?: number;
            duration?: number;
            playerState?: number;
          };
        };
        if (data.event === "infoDelivery" && data.info) {
          const { currentTime, duration, playerState } = data.info;
          if (typeof currentTime === "number") progressRef.current.currentTime = currentTime;
          if (typeof duration === "number") progressRef.current.duration = duration;
          if (typeof playerState === "number") {
            progressRef.current.playing = playerState === 1;
            if (playerState === 1) {
              setNeedsAudioClick(false);
              endedSentRef.current = false;
            }
            // 0 = ENDED -> avisar a la consola (auto-siguiente)
            if (playerState === 0 && !endedSentRef.current && videoIdRef.current) {
              endedSentRef.current = true;
              writeEvent("ended");
            }
          }

        }
        if (data.event === "onError" && typeof data.info === "number") {
          const code = data.info;
          const errorTitle = titleRef.current || videoIdRef.current;
          setEmbedError(
            code === 101 || code === 150
              ? "Canción con restricción de autor, pasando a la siguiente…"
              : `Error de reproducción de YouTube (código ${code})`,
          );
          // No dejar el aviso más de 1 segundo en pantalla
          window.setTimeout(() => setEmbedError(null), 1000);
          writeEvent("embed_error", { code, title: errorTitle });
          channelRef.current?.postMessage({
            type: "embed_error",
            videoId: videoIdRef.current,
            title: errorTitle,
            code,
          } satisfies TvMessage);
        }
      } catch {
        /* mensaje no json */
      }
    };
    window.addEventListener("message", onMessage);

    // 5) Reportar progreso + latido al panel cada segundo
    const interval = window.setInterval(() => {
      // Respaldo: si el evento 'storage' no llega, se lee el mensaje igualmente
      setMessage((prev) => {
        const stored = readStoredMessage();
        return stored === prev ? prev : stored;
      });
      writeEvent("heartbeat");
      channelRef.current?.postMessage({
        type: "state",
        duration: progressRef.current.duration,
        currentTime: progressRef.current.currentTime,
        playing: progressRef.current.playing,
      } satisfies TvMessage);
    }, 1000);


    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
      window.clearInterval(interval);
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
      channelRef.current = null;
    };
  }, [applyCommand, sendIframeCommand, writeEvent]);

  // Activar el canal de datos del iframe cada vez que cambia el video
  useEffect(() => {
    if (!videoId) return;
    // 'listening' habilita los eventos infoDelivery (progreso/estado)
    const t = window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening" }), "*");
      // Detectar autoplay bloqueado: si tras cargar no llega estado PLAYING, mostrar botón
      window.setTimeout(() => {
        if (!progressRef.current.playing) setNeedsAudioClick(true);
      }, 2500);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [videoId]);

  const embedSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(
        window.location.origin,
      )}&rel=0&modestbranding=1&playsinline=1&controls=0&iv_load_policy=3`
    : "";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute inset-0">
        {videoId && (
          <iframe
            key={videoId}
            ref={iframeRef}
            src={embedSrc}
            title={title || "Reproductor de karaoke"}
            className="size-full border-0"
            allow={IFRAME_ALLOW}
            allowFullScreen
          />
        )}
      </div>

      {embedError && (
        <div className="pointer-events-none absolute inset-x-0 top-8 z-20 flex justify-center px-6">
          <p className="rounded-full border border-red-500/40 bg-red-950/80 px-6 py-3 text-sm font-semibold text-red-200 backdrop-blur-md">
            {embedError} — saltando a la siguiente canción…
          </p>
        </div>
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

      {!title && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm uppercase tracking-[0.4em] text-white/40">
            Esperando la señal de la consola
          </p>
        </div>
      )}

      {(title || message) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6">
          <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-black/55 px-6 py-4 backdrop-blur-md">
            {title && (
              <p className="truncate text-lg font-semibold text-white/90 md:text-2xl">
                Sonando ahora: {title}
              </p>
            )}
            {message && (
              <p className="mt-1 truncate text-base text-white/70 md:text-xl">{message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
