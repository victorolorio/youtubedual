import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  COMMAND_STORAGE,
  CROSSFADE_STORAGE,
  EVENT_STORAGE,
  MESSAGE_STORAGE,
  VOLUME_STORAGE,
  createTvChannel,
  type DeckId,
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
          "Salida limpia a pantalla completa para TV: reproduce la cola de karaoke con transiciones crossfade entre dos decks.",
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

/** Segundos restantes a partir de los cuales se recorta el silencio final. */
const TAIL_TRIM_SECONDS = 3;
/** Espera antes de arrancar el crossfade, para que el deck entrante bufferice. */
const PRELOAD_DELAY = 900;
const DEFAULT_CROSSFADE = 2000;

type DeckState = { videoId: string; title: string };

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

function readCrossfade(): number {
  const raw = window.localStorage.getItem(CROSSFADE_STORAGE);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CROSSFADE;
}

function embedUrl(videoId: string, origin: string) {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(
    origin,
  )}&rel=0&modestbranding=1&playsinline=1&controls=0&iv_load_policy=3&fs=0&disablekb=1&showinfo=0&cc_load_policy=0&color=white`;
}

function PlayerScreen() {
  const deckRefs = [
    useRef<HTMLIFrameElement>(null),
    useRef<HTMLIFrameElement>(null),
  ] as const;
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastCommandTsRef = useRef(0);
  const progressRef = useRef({ duration: 0, currentTime: 0, playing: false });
  const endedSentRef = useRef(false);
  const targetVolumeRef = useRef(80);
  const crossfadeRef = useRef(DEFAULT_CROSSFADE);
  const fadeTimerRef = useRef<number | null>(null);
  const preloadTimerRef = useRef<number | null>(null);

  const [decks, setDecks] = useState<[DeckState, DeckState]>([
    { videoId: "", title: "" },
    { videoId: "", title: "" },
  ]);
  const [activeDeck, setActiveDeck] = useState<0 | 1>(0);
  const [opacities, setOpacities] = useState<[number, number]>([1, 0]);
  const [message, setMessage] = useState("");
  const [needsAudioClick, setNeedsAudioClick] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const decksRef = useRef(decks);
  const activeDeckRef = useRef<0 | 1>(0);
  decksRef.current = decks;
  activeDeckRef.current = activeDeck;

  const deckLabel = useCallback((idx: 0 | 1): DeckId => (idx === 0 ? "A" : "B"), []);

  /** Escribe un evento para la consola (funciona entre ventanas vía localStorage). */
  const writeEvent = useCallback(
    (kind: TvEvent["kind"], extra?: { code?: number; title?: string }) => {
      try {
        window.localStorage.setItem(
          EVENT_STORAGE,
          JSON.stringify({
            kind,
            deck: activeDeckRef.current === 0 ? "A" : "B",
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

  /** Enviar un comando a la API del iframe de un deck concreto. */
  const sendDeck = useCallback(
    (idx: 0 | 1, func: string, args: unknown[] = []) => {
      const win = deckRefs[idx].current?.contentWindow;
      if (!win) return;
      win.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Comando dirigido al deck que está al aire. */
  const sendActive = useCallback(
    (func: string, args: unknown[] = []) => sendDeck(activeDeckRef.current, func, args),
    [sendDeck],
  );

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current) window.clearInterval(fadeTimerRef.current);
    if (preloadTimerRef.current) window.clearTimeout(preloadTimerRef.current);
    fadeTimerRef.current = null;
    preloadTimerRef.current = null;
  }, []);

  /** Ejecuta el crossfade de vídeo + audio del deck saliente al entrante. */
  const runCrossfade = useCallback(
    (incoming: 0 | 1) => {
      const outgoing = (incoming === 0 ? 1 : 0) as 0 | 1;
      const target = targetVolumeRef.current;
      const duration = crossfadeRef.current;

      if (fadeTimerRef.current) window.clearInterval(fadeTimerRef.current);

      const finish = () => {
        setOpacities(incoming === 0 ? [1, 0] : [0, 1]);
        setActiveDeck(incoming);
        activeDeckRef.current = incoming;
        sendDeck(incoming, "setVolume", [target]);
        sendDeck(incoming, "unMute");
        sendDeck(outgoing, "setVolume", [0]);
        sendDeck(outgoing, "pauseVideo");
        progressRef.current = { duration: 0, currentTime: 0, playing: true };
        endedSentRef.current = false;
      };

      if (duration <= 0) {
        finish();
        return;
      }

      const step = 60;
      const started = Date.now();
      fadeTimerRef.current = window.setInterval(() => {
        const t = Math.min(1, (Date.now() - started) / duration);
        const inOpacity = t;
        const outOpacity = 1 - t;
        setOpacities(
          incoming === 0
            ? [inOpacity, outOpacity]
            : [outOpacity, inOpacity],
        );
        sendDeck(incoming, "setVolume", [Math.round(target * t)]);
        sendDeck(outgoing, "setVolume", [Math.round(target * (1 - t))]);
        if (t >= 1) {
          if (fadeTimerRef.current) window.clearInterval(fadeTimerRef.current);
          fadeTimerRef.current = null;
          finish();
        }
      }, step);
    },
    [sendDeck],
  );

  /** Carga una pista en el deck inactivo y hace la transición. */
  const loadIntoIdleDeck = useCallback(
    (videoId: string, title: string) => {
      const incoming = (activeDeckRef.current === 0 ? 1 : 0) as 0 | 1;
      clearTimers();
      setEmbedError(null);
      endedSentRef.current = false;

      setDecks((prev) => {
        const copy: [DeckState, DeckState] = [prev[0], prev[1]];
        copy[incoming] = { videoId, title };
        decksRef.current = copy;
        return copy;
      });

      // El deck entrante empieza mudo e invisible; se revela con el crossfade.
      preloadTimerRef.current = window.setTimeout(() => {
        sendDeck(incoming, "setVolume", [0]);
        sendDeck(incoming, "playVideo");
        deckRefs[incoming].current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening" }),
          "*",
        );
        runCrossfade(incoming);
      }, crossfadeRef.current > 0 ? PRELOAD_DELAY : 200);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimers, runCrossfade, sendDeck],
  );

  const applyCommand = useCallback(
    (cmd: TvCommand) => {
      if (cmd.timestamp <= lastCommandTsRef.current) return;
      lastCommandTsRef.current = cmd.timestamp;

      switch (cmd.action) {
        case "PLAY": {
          const activeVideo = decksRef.current[activeDeckRef.current].videoId;
          if (cmd.videoId && cmd.videoId !== activeVideo) {
            loadIntoIdleDeck(cmd.videoId, cmd.title ?? "");
          } else {
            sendActive("playVideo");
          }
          break;
        }
        case "PAUSE":
          sendActive("pauseVideo");
          break;
        case "RESTART":
          sendActive("seekTo", [0, true]);
          sendActive("playVideo");
          break;
        case "MESSAGE":
          setMessage(cmd.text);
          break;
        case "CLEAR": {
          clearTimers();
          sendDeck(0, "pauseVideo");
          sendDeck(1, "pauseVideo");
          const empty: [DeckState, DeckState] = [
            { videoId: "", title: "" },
            { videoId: "", title: "" },
          ];
          decksRef.current = empty;
          setDecks(empty);
          setOpacities([1, 0]);
          setActiveDeck(0);
          activeDeckRef.current = 0;
          break;
        }
      }
    },
    [clearTimers, loadIntoIdleDeck, sendActive, sendDeck],
  );

  const activateAudio = () => {
    sendActive("unMute");
    sendActive("setVolume", [targetVolumeRef.current]);
    sendActive("playVideo");
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


  // Sincronización dual: evento 'storage' (principal) + BroadcastChannel (respaldo)
  useEffect(() => {
    crossfadeRef.current = readCrossfade();
    const savedVolume = window.localStorage.getItem(VOLUME_STORAGE);
    if (savedVolume != null) {
      const v = Number(savedVolume);
      if (Number.isFinite(v)) targetVolumeRef.current = v;
    }

    const last = readCommand();
    if (last) applyCommand(last);

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
        if (Number.isFinite(v)) {
          targetVolumeRef.current = v;
          sendActive("setVolume", [v]);
        }
      }
      if (e.key === CROSSFADE_STORAGE && e.newValue != null) {
        crossfadeRef.current = readCrossfade();
      }
      if (e.key === MESSAGE_STORAGE) {
        setMessage(readStoredMessage());
      }
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
            applyCommand({
              action: "PLAY",
              videoId: data.videoId,
              title: data.title,
              timestamp: Date.now(),
            });
            break;
          case "play":
            sendActive("playVideo");
            break;
          case "pause":
            sendActive("pauseVideo");
            break;
          case "restart":
            sendActive("seekTo", [0, true]);
            sendActive("playVideo");
            break;
          case "volume":
            targetVolumeRef.current = data.volume;
            sendActive("setVolume", [data.volume]);
            break;
          case "crossfade":
            crossfadeRef.current = data.ms;
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

    // Mensajes de los iframes de YouTube (progreso, estado, errores)
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin !== "string" || !e.origin.includes("youtube.com")) return;
      if (typeof e.data !== "string") return;
      const fromActive =
        e.source === deckRefs[activeDeckRef.current].current?.contentWindow;
      try {
        const data = JSON.parse(e.data) as {
          event?: string;
          info?: {
            currentTime?: number;
            duration?: number;
            playerState?: number;
          };
        };
        if (data.event === "infoDelivery" && data.info && fromActive) {
          const { currentTime, duration, playerState } = data.info;
          if (typeof currentTime === "number") progressRef.current.currentTime = currentTime;
          if (typeof duration === "number") progressRef.current.duration = duration;
          if (typeof playerState === "number") {
            progressRef.current.playing = playerState === 1;
            if (playerState === 1) {
              setNeedsAudioClick(false);
              endedSentRef.current = false;
            }
            if (
              playerState === 0 &&
              !endedSentRef.current &&
              decksRef.current[activeDeckRef.current].videoId
            ) {
              endedSentRef.current = true;
              writeEvent("ended");
            }
          }
        }
        if (data.event === "onError" && typeof data.info === "number") {
          const code = data.info;
          const activeState = decksRef.current[activeDeckRef.current];
          const errorTitle = activeState.title || activeState.videoId;
          setEmbedError(
            code === 101 || code === 150
              ? "Canción con restricción de autor, pasando a la siguiente…"
              : `Error de reproducción de YouTube (código ${code})`,
          );
          window.setTimeout(() => setEmbedError(null), 1000);
          writeEvent("embed_error", { code, title: errorTitle });
          channelRef.current?.postMessage({
            type: "embed_error",
            videoId: activeState.videoId,
            title: errorTitle,
            code,
          } satisfies TvMessage);
        }
      } catch {
        /* mensaje no json */
      }
    };
    window.addEventListener("message", onMessage);

    // Progreso + latido + recorte de silencio final
    const interval = window.setInterval(() => {
      setMessage((prev) => {
        const stored = readStoredMessage();
        return stored === prev ? prev : stored;
      });

      const { duration, currentTime } = progressRef.current;
      const remaining = duration - currentTime;
      if (
        duration > 5 &&
        remaining <= TAIL_TRIM_SECONDS &&
        !endedSentRef.current &&
        decksRef.current[activeDeckRef.current].videoId
      ) {
        endedSentRef.current = true;
        writeEvent("ended");
      }

      writeEvent("heartbeat");
      channelRef.current?.postMessage({
        type: "state",
        duration: progressRef.current.duration,
        currentTime: progressRef.current.currentTime,
        playing: progressRef.current.playing,
        deck: activeDeckRef.current === 0 ? "A" : "B",
      } satisfies TvMessage);
    }, 500);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
      window.clearInterval(interval);
      clearTimers();
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCommand, clearTimers, sendActive, writeEvent]);

  // Habilitar el canal de datos de cada deck al cambiar su vídeo
  useEffect(() => {
    const timers: number[] = [];
    ([0, 1] as const).forEach((idx) => {
      if (!decks[idx].videoId) return;
      timers.push(
        window.setTimeout(() => {
          deckRefs[idx].current?.contentWindow?.postMessage(
            JSON.stringify({ event: "listening" }),
            "*",
          );
        }, 1200),
      );
    });
    timers.push(
      window.setTimeout(() => {
        if (
          decksRef.current[activeDeckRef.current].videoId &&
          !progressRef.current.playing
        ) {
          setNeedsAudioClick(true);
        }
      }, 4000),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks[0].videoId, decks[1].videoId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const anyVideo = decks[0].videoId || decks[1].videoId;

  return (
    <div className="fixed inset-0 m-0 h-screen max-h-full w-screen max-w-full overflow-hidden bg-black p-0">
      {/* Dos decks superpuestos: el activo visible, el otro precargado y mudo. */}
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
          {([0, 1] as const).map((idx) =>
            decks[idx].videoId ? (
              <iframe
                key={`deck-${idx}-${decks[idx].videoId}`}
                ref={deckRefs[idx]}
                src={embedUrl(decks[idx].videoId, origin)}
                title={decks[idx].title || `Deck ${deckLabel(idx)}`}
                className="pointer-events-none absolute inset-0 h-full w-full border-0"
                style={{
                  opacity: opacities[idx],
                  zIndex: activeDeck === idx ? 2 : 1,
                }}
                allow={IFRAME_ALLOW}
                allowFullScreen
              />
            ) : null,
          )}
        </div>
      </div>


      {embedError && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center px-6 md:top-10 md:px-10">

          <p className="rounded-full border border-red-500/40 bg-red-950/80 px-6 py-3 text-sm font-semibold text-red-200 backdrop-blur-md">
            {embedError}
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

      {!anyVideo && (
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
        className={`absolute bottom-6 right-6 z-30 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-xs uppercase tracking-widest text-white/70 backdrop-blur-md transition-opacity duration-500 hover:text-white ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        ⛶ Pantalla completa
      </button>

      {message && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-6 md:px-10 md:pb-10">
          <div className="tv-ticker mx-auto max-w-4xl rounded-2xl border border-white/10 bg-black/55 px-6 py-4 backdrop-blur-md">

            <p className="truncate text-center text-base text-white/85 md:text-2xl">
              {message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
