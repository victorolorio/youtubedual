import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  History as HistoryIcon,
  Keyboard,
  KeyRound,
  ListPlus,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  COMMAND_STORAGE,
  EVENT_STORAGE,
  MESSAGE_STORAGE,
  VOLUME_STORAGE,
  createTvChannel,
  fetchVideoTitle,
  formatTime,
  parseVideoId,
  searchYouTube,
  type QueueTrack,
  type TvCommand,
  type TvEvent,
  type TvMessage,
  type YouTubeSearchResult,
} from "@/lib/tv-channel";

const API_KEY_STORAGE = "youtube_api_key";
const AUTONEXT_STORAGE = "tv_auto_next";
const KARAOKE_MODE_STORAGE = "tv_karaoke_mode";

function sendStorageMessage(text: string) {
  try {
    window.localStorage.setItem(
      MESSAGE_STORAGE,
      JSON.stringify({ text, timestamp: Date.now() }),
    );
  } catch {
    /* almacenamiento no disponible */
  }
}

function sendStorageCommand(cmd: TvCommand) {
  try {
    window.localStorage.setItem(COMMAND_STORAGE, JSON.stringify(cmd));
  } catch {
    /* almacenamiento no disponible */
  }
}

function sendStorageVolume(volume: number) {
  try {
    window.localStorage.setItem(VOLUME_STORAGE, String(volume));
  } catch {
    /* almacenamiento no disponible */
  }
}


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Consola DJ Karaoke — Control de Video en Doble Pantalla" },
      {
        name: "description",
        content:
          "Panel de control DJ para karaoke: gestiona la cola de YouTube, reproduce, pausa y envía mensajes a la pantalla de TV en tiempo real.",
      },
      { property: "og:title", content: "Consola DJ Karaoke — Control de Video" },
      {
        property: "og:description",
        content:
          "Controla la cola de karaoke y la pantalla de TV desde un panel oscuro estilo consola de DJ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [queue, setQueue] = useState<QueueTrack[]>([]);
  const [current, setCurrent] = useState<QueueTrack | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [screenMessage, setScreenMessage] = useState("");
  const [volume, setVolume] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const [karaokeMode, setKaraokeMode] = useState(true);
  const [tvOnline, setTvOnline] = useState(false);
  const [history, setHistory] = useState<QueueTrack[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const preMuteRef = useRef(80);


  const send = useCallback((message: TvMessage) => {
    console.log("[TV channel] enviando", message);
    channelRef.current?.postMessage(message);
  }, []);

  const currentRef = useRef<QueueTrack | null>(null);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(volume);
  const queueRef = useRef<QueueTrack[]>([]);
  const autoNextRef = useRef(autoNext);
  const lastSkipRef = useRef(0);
  const lastAliveRef = useRef(0);
  currentRef.current = current;
  isPlayingRef.current = isPlaying;
  volumeRef.current = volume;
  queueRef.current = queue;
  autoNextRef.current = autoNext;

  useEffect(() => {
    const saved = window.localStorage.getItem(API_KEY_STORAGE) ?? "";
    setApiKey(saved);
    setKeyDraft(saved);
    const savedAuto = window.localStorage.getItem(AUTONEXT_STORAGE);
    if (savedAuto != null) setAutoNext(savedAuto === "1");
    const savedKaraoke = window.localStorage.getItem(KARAOKE_MODE_STORAGE);
    if (savedKaraoke != null) setKaraokeMode(savedKaraoke === "1");
  }, []);

  // Eventos que llegan desde la ventana de TV (latido + fin de canción)
  useEffect(() => {
    const handleEvent = (ev: TvEvent) => {
      lastAliveRef.current = ev.timestamp;
      setTvOnline(true);
      setDuration(ev.duration);
      setElapsed(ev.currentTime);
      setIsPlaying(ev.playing);
      if (ev.kind === "embed_error") {
        if (Date.now() - lastSkipRef.current < 3000) return;
        lastSkipRef.current = Date.now();
        toast.error("Canción con restricción de autor, pasando a la siguiente");
        setStatus("Canción con restricción de autor, pasando a la siguiente");
        window.setTimeout(() => nextRef.current(), 300);
        return;
      }
      if (ev.kind === "ended" && autoNextRef.current) {
        setStatus("Canción terminada. Pasando a la siguiente…");
        window.setTimeout(() => nextRef.current(), 600);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== EVENT_STORAGE || !e.newValue) return;
      try {
        handleEvent(JSON.parse(e.newValue) as TvEvent);
      } catch {
        /* json inválido */
      }
    };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => {
      setTvOnline(Date.now() - lastAliveRef.current < 4000);
    }, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, []);


  useEffect(() => {
    const channel = createTvChannel();
    channelRef.current = channel;
    if (!channel) return;

    channel.onmessage = (event: MessageEvent<TvMessage>) => {
      const data = event.data;
      if (data.type !== "state") console.log("[TV channel] recibido", data);
      if (data.type === "state") {
        lastAliveRef.current = Date.now();
        setTvOnline(true);
        setDuration(data.duration);
        setElapsed(data.currentTime);
        setIsPlaying(data.playing);
      }

      if (data.type === "embed_error") {
        if (Date.now() - lastSkipRef.current < 3000) return;
        lastSkipRef.current = Date.now();
        // Video bloqueado para embeber: avisar y saltar a la siguiente canción
        toast.error("Canción con restricción de autor, pasando a la siguiente");
        setStatus("Canción con restricción de autor, pasando a la siguiente");
        window.setTimeout(() => nextRef.current(), 300);
      }
      if (data.type === "request_state") {
        // La TV se abrió después: reenviar pista actual, acción y volumen
        const track = currentRef.current;
        if (track) {
          channel.postMessage({
            type: "play_video",
            videoId: track.videoId,
            title: track.title,
          } satisfies TvMessage);
          channel.postMessage({
            type: isPlayingRef.current ? "play" : "pause",
          } satisfies TvMessage);
        }
        channel.postMessage({
          type: "volume",
          volume: volumeRef.current,
        } satisfies TvMessage);
      }
    };

    return () => {
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const tvWindowRef = useRef<Window | null>(null);

  const openTv = useCallback(() => {
    const existing = tvWindowRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const win = window.open("/player", "TVPlayer", "width=1280,height=720");
    if (win) {
      tvWindowRef.current = win;
      win.focus();
    }
  }, []);

  /**
   * Abre la TV solo si realmente no hay ninguna pantalla activa.
   * Se usa el latido (heartbeat) de la TV para detectar ventanas abiertas
   * aunque no las haya abierto esta pestaña.
   */
  const ensureTvOpen = useCallback(() => {
    const aliveRecently = Date.now() - lastAliveRef.current < 5000;
    const ownWindowOpen = !!tvWindowRef.current && !tvWindowRef.current.closed;
    if (aliveRecently || ownWindowOpen) return;
    openTv();
  }, [openTv]);


  const playTrack = useCallback(
    (track: QueueTrack) => {
      setCurrent(track);
      setIsPlaying(true);
      setDuration(0);
      setElapsed(0);
      console.log("[TV channel] emit play_video", track);
      // Sincronización dual: BroadcastChannel + comando persistente en localStorage
      send({ type: "play_video", videoId: track.videoId, title: track.title });
      send({ type: "play" });
      sendStorageCommand({
        action: "PLAY",
        videoId: track.videoId,
        title: track.title,
        timestamp: Date.now(),
      });
      ensureTvOpen();
      setStatus(`Reproduciendo «${track.title}».`);
    },
    [send, ensureTvOpen],
  );

  const playTrackRef = useRef(playTrack);
  playTrackRef.current = playTrack;

  const addToQueue = async () => {
    const videoId = parseVideoId(urlInput);
    if (!videoId) {
      setStatus("URL o ID de YouTube no válido.");
      return;
    }
    setAdding(true);
    const title = await fetchVideoTitle(videoId);
    const track: QueueTrack = {
      id: `${videoId}-${Date.now()}`,
      videoId,
      title,
    };
    setAdding(false);
    setUrlInput("");
    setStatus(`Agregado: ${title}`);

    if (!current) {
      playTrack(track);
    } else {
      setQueue((q) => [...q, track]);
    }
  };

  const enqueueResult = (result: YouTubeSearchResult) => {
    const track: QueueTrack = {
      id: `${result.videoId}-${Date.now()}`,
      videoId: result.videoId,
      title: result.title,
    };
    setQueue((q) => [...q, track]);
    setStatus(`En cola: ${result.title}`);
  };

  const playNowResult = (result: YouTubeSearchResult) => {
    if (current) {
      setQueue((q) => [current, ...q]);
    }
    playTrack({
      id: `${result.videoId}-${Date.now()}`,
      videoId: result.videoId,
      title: result.title,
    });
  };

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!apiKey) {
      setSearchError("Configura tu YouTube API Key en ajustes para buscar.");
      setSettingsOpen(true);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      // Modo karaoke: añade la palabra automáticamente si no está escrita
      const finalQuery =
        karaokeMode && !/karaoke/i.test(query) ? `${query} karaoke` : query;
      setResults(await searchYouTube(finalQuery, apiKey));
    } catch (err) {
      setResults([]);
      setSearchError(
        err instanceof Error ? err.message : "Error al buscar en YouTube.",
      );
    } finally {
      setSearching(false);
    }
  };

  const saveApiKey = () => {
    const trimmed = keyDraft.trim();
    window.localStorage.setItem(API_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setSettingsOpen(false);
    setStatus(trimmed ? "API Key guardada." : "API Key eliminada.");
  };

  const next = useCallback(() => {
    const playing = currentRef.current;
    if (playing) {
      setHistory((h) => [playing, ...h.filter((t) => t.id !== playing.id)].slice(0, 30));
    }
    const [head, ...rest] = queueRef.current;
    if (!head) {
      setCurrent(null);
      setIsPlaying(false);
      setDuration(0);
      setElapsed(0);
      send({ type: "clear" });
      sendStorageCommand({ action: "CLEAR", timestamp: Date.now() });
      setStatus("La cola está vacía.");
      return;
    }
    setQueue(rest);
    playTrackRef.current(head);
  }, [send]);

  const nextRef = useRef(next);
  nextRef.current = next;

  const applyVolume = useCallback(
    (value: number) => {
      const v = Math.max(0, Math.min(100, Math.round(value)));
      setVolume(v);
      send({ type: "volume", volume: v });
      sendStorageVolume(v);
      return v;
    },
    [send],
  );

  const togglePlay = useCallback(() => {
    if (!currentRef.current) return;
    if (isPlayingRef.current) {
      setIsPlaying(false);
      send({ type: "pause" });
      sendStorageCommand({ action: "PAUSE", timestamp: Date.now() });
    } else {
      setIsPlaying(true);
      send({ type: "play" });
      sendStorageCommand({
        action: "PLAY",
        videoId: currentRef.current.videoId,
        title: currentRef.current.title,
        timestamp: Date.now(),
      });
    }
  }, [send]);

  const toggleMute = useCallback(() => {
    if (mutedRef.current) {
      mutedRef.current = false;
      setMuted(false);
      applyVolume(preMuteRef.current || 60);
    } else {
      mutedRef.current = true;
      preMuteRef.current = volumeRef.current || 60;
      setMuted(true);
      applyVolume(0);
    }
  }, [applyVolume]);

  // Atajos de teclado del DJ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          nextRef.current();
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume(volumeRef.current + 5);
          setMuted(false);
          mutedRef.current = false;
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume(volumeRef.current - 5);
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyVolume, togglePlay, toggleMute]);


  const move = (index: number, direction: -1 | 1) => {
    setQueue((q) => {
      const target = index + direction;
      if (target < 0 || target >= q.length) return q;
      const copy = [...q];
      const a = copy[index]!;
      const b = copy[target]!;
      copy[index] = b;
      copy[target] = a;
      return copy;
    });
  };

  const remove = (id: string) => setQueue((q) => q.filter((t) => t.id !== id));

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
              Dual Screen
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              Consola DJ / Karaoke
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Controla la pantalla de TV en tiempo real sin backend.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="lg" onClick={openTv} className="shadow-glow">
              <MonitorPlay className="size-5" />
              Abrir Pantalla TV
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Ajustes"
              onClick={() => {
                setKeyDraft(apiKey);
                setSettingsOpen(true);
              }}
            >
              <Settings className="size-5" />
            </Button>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">


        <section className="panel-surface rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Buscar en YouTube
          </h2>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Busca canciones, artistas o karaoke..."
              aria-label="Buscar videos en YouTube"
            />
            <Button type="submit" disabled={searching}>
              <Search className="size-4" />
              {searching ? "Buscando..." : "Buscar"}
            </Button>
          </form>

          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border p-3">
            <Switch
              id="karaoke-mode"
              checked={karaokeMode}
              onCheckedChange={(checked) => {
                setKaraokeMode(checked);
                window.localStorage.setItem(
                  KARAOKE_MODE_STORAGE,
                  checked ? "1" : "0",
                );
              }}
            />
            <Label htmlFor="karaoke-mode" className="text-sm">
              {karaokeMode
                ? "Modo karaoke (agrega «karaoke» automáticamente)"
                : "Modo video normal"}
            </Label>
          </div>

          {!apiKey && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
              <KeyRound className="size-4 shrink-0 text-primary" />
              <span>
                No hay API Key configurada.{" "}
                <button
                  type="button"
                  className="font-semibold text-primary underline"
                  onClick={() => {
                    setKeyDraft(apiKey);
                    setSettingsOpen(true);
                  }}
                >
                  Abre ajustes
                </button>{" "}
                para pegar tu YouTube Data API Key.
              </span>
            </div>
          )}
          {searchError && (
            <p className="mt-2 text-sm text-destructive">{searchError}</p>
          )}

          {results.length > 0 && (
            <ul className="mt-4 space-y-2">
              {results.map((r) => (
                <li
                  key={r.videoId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
                >
                  {r.thumbnail && (
                    <img
                      src={r.thumbnail}
                      alt={r.title}
                      loading="lazy"
                      className="h-16 w-28 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.channel}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <Button size="sm" onClick={() => playNowResult(r)}>
                      <Play className="size-4" /> Reproducir Ya
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => enqueueResult(r)}
                    >
                      <ListPlus className="size-4" /> A la cola
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-surface rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Sonando ahora
          </h2>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="truncate text-xl font-semibold">
              {current ? current.title : "Sin reproducción"}
            </p>
            <p className="font-mono text-sm text-primary">
              {formatTime(elapsed)} / {formatTime(duration)}
            </p>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: duration > 0 ? `${(elapsed / duration) * 100}%` : "0%" }}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setIsPlaying(true);
                send({ type: "play" });
                sendStorageCommand({
                  action: "PLAY",
                  videoId: current?.videoId ?? "",
                  title: current?.title ?? "",
                  timestamp: Date.now(),
                });

              }}
              disabled={!current}
            >
              <Play className="size-4" /> Play
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsPlaying(false);
                send({ type: "pause" });
                sendStorageCommand({ action: "PAUSE", timestamp: Date.now() });
              }}
              disabled={!current}
            >
              <Pause className="size-4" /> Pausa
            </Button>
            <Button variant="secondary" onClick={next}>
              <SkipForward className="size-4" /> Siguiente
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                send({ type: "restart" });
                sendStorageCommand({ action: "RESTART", timestamp: Date.now() });
              }}
              disabled={!current}
            >
              <RotateCcw className="size-4" /> Reiniciar
            </Button>
            <Button
              variant={muted ? "default" : "outline"}
              onClick={toggleMute}
              aria-label="Silenciar"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {muted ? "Sin sonido" : "Mute"}
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {isPlaying ? "● En reproducción" : "❚❚ En pausa"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            <Keyboard className="size-4 text-primary" />
            <span><kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">Espacio</kbd> play/pausa</span>
            <span><kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">→</kbd> siguiente</span>
            <span><kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">↑ ↓</kbd> volumen ±5%</span>
            <span><kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">M</kbd> mute</span>
          </div>


          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border p-3">
            <Switch
              id="auto-next"
              checked={autoNext}
              onCheckedChange={(checked) => {
                setAutoNext(checked);
                window.localStorage.setItem(AUTONEXT_STORAGE, checked ? "1" : "0");
              }}
            />
            <Label htmlFor="auto-next" className="text-sm">
              Pasar automáticamente a la siguiente canción
            </Label>
            <span className="ml-auto text-xs text-muted-foreground">
              TV: {tvOnline ? "conectada" : "desconectada"}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Volume2 className="size-5 text-muted-foreground" />
            <Slider
              value={[volume]}
              max={100}
              step={1}
              onValueChange={(v) => {
                const next = v[0] ?? 0;
                setVolume(next);
                send({ type: "volume", volume: next });
                sendStorageVolume(next);
              }}
              className="max-w-sm"

            />
            <span className="w-10 font-mono text-sm text-muted-foreground">{volume}</span>
          </div>
        </section>

        <section className="panel-surface rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Mensaje en pantalla
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Aparece como overlay en la TV, por ejemplo: “Turno de Juan”.
          </p>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = screenMessage.trim();
              send({ type: "message", text });
              sendStorageCommand({ action: "MESSAGE", text, timestamp: Date.now() });
              sendStorageMessage(text);
              ensureTvOpen();
              setStatus(text ? `Mensaje enviado: «${text}»` : "Mensaje limpiado.");
            }}
          >
            <Input
              value={screenMessage}
              onChange={(e) => setScreenMessage(e.target.value)}
              placeholder="Turno de Juan"
              aria-label="Mensaje para la pantalla de TV"
            />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                <Send className="size-4" /> Proyectar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setScreenMessage("");
                  send({ type: "message", text: "" });
                  sendStorageCommand({
                    action: "MESSAGE",
                    text: "",
                    timestamp: Date.now(),
                  });
                  sendStorageMessage("");
                  setStatus("Mensaje quitado de la TV.");
                }}
              >
                Quitar
              </Button>

            </div>
          </form>
        </section>
        </div>

        <aside className="panel-surface h-fit rounded-2xl p-5 lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Cola de reproducción
          </h2>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addToQueue();
            }}
          >
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Pega la URL de YouTube o el ID del video"
              aria-label="URL o ID de YouTube"
            />
            <Button type="submit" disabled={adding}>
              <Plus className="size-4" />
              {adding ? "Agregando..." : "Agregar a la cola"}
            </Button>
          </form>
          {status && <p className="mt-2 text-xs text-muted-foreground">{status}</p>}

          <ul className="mt-4 space-y-2 lg:max-h-[60vh] lg:overflow-y-auto">
            {queue.length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                La cola está vacía. Agrega la primera canción.
              </li>
            )}
            {queue.map((track, index) => (
              <li
                key={track.id}
                className="flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-2"
              >
                <span className="w-6 shrink-0 text-center font-mono text-sm text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{track.title}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Subir"
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Bajar"
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Eliminar"
                  onClick={() => remove(track.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
              onClick={() => setHistoryOpen((o) => !o)}
            >
              <HistoryIcon className="size-4" />
              Historial ({history.length})
              <span className="ml-auto text-xs">{historyOpen ? "▲" : "▼"}</span>
            </button>
            {historyOpen && (
              <ul className="mt-3 space-y-2">
                {history.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Aún no ha sonado ninguna canción.
                  </li>
                )}
                {history.map((track) => (
                  <li
                    key={`h-${track.id}`}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {track.title}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Volver a la cola"
                      onClick={() => {
                        setQueue((q) => [
                          ...q,
                          { ...track, id: `${track.videoId}-${Date.now()}` },
                        ]);
                        setStatus(`En cola de nuevo: ${track.title}`);
                      }}
                    >
                      <ListPlus className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        </div>

      </div>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Ajustes"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Ajustes</h2>
              <p className="text-sm text-muted-foreground">
                Pega tu YouTube Data API v3 Key. Se guarda solo en este
                navegador (localStorage) y se usa para buscar videos.
              </p>
            </div>
            <div className="space-y-2">
              <Input
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="AIza..."
                aria-label="YouTube API Key"
                type="password"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Obtén una clave gratis en Google Cloud Console habilitando
                “YouTube Data API v3”.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={saveApiKey}>
                <KeyRound className="size-4" /> Guardar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
