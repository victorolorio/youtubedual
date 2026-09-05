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
  QrCode,
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
  CROSSFADE_STORAGE,
  EVENT_STORAGE,
  MESSAGE_STORAGE,
  VOLUME_STORAGE,
  createTvChannel,
  fetchVideoTitle,
  formatTime,
  parseVideoId,
  searchYouTube,
  type DeckId,
  type QueueTrack,
  type TvCommand,
  type TvEvent,
  type TvMessage,
  type YouTubeSearchResult,
} from "@/lib/tv-channel";
import { supabase } from "@/integrations/supabase/client";
import {
  randomPin,
  saveSettings,
  useKaraokeSettings,
} from "@/lib/karaoke-settings";
import { QRCodeSVG } from "qrcode.react";

type KaraokeRequest = {
  id: string;
  requester_name: string;
  video_id: string;
  song_title: string;
  song_channel: string;
  thumbnail_url: string;
  status: string;
  request_type?: string;
  created_at: string;
};


/** Píldora de color según el tipo de pedido. */
function TypeBadge({ type }: { type?: string | undefined }) {
  const isVideo = type === "music_video";
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        isVideo
          ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40"
          : "bg-violet-500/20 text-violet-300 ring-1 ring-violet-400/40"
      }`}
    >
      {isVideo ? "🎬 Video Musical" : "🎤 Karaoke"}
    </span>
  );
}

const API_KEY_STORAGE = "youtube_api_key";
const AUTONEXT_STORAGE = "tv_auto_next";
const KARAOKE_MODE_STORAGE = "tv_karaoke_mode";
const QUEUE_STORAGE = "dj_queue";
const CURRENT_STORAGE = "dj_current";
const PUBLIC_URL_STORAGE = "dj_public_url";


function persistQueue(list: QueueTrack[]) {
  try {
    window.localStorage.setItem(QUEUE_STORAGE, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible */
  }
}

const CROSSFADE_OPTIONS = [
  { label: "Corte directo", ms: 0 },
  { label: "1 s", ms: 1000 },
  { label: "2 s", ms: 2000 },
  { label: "3 s", ms: 3000 },
];


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

function sendStorageCrossfade(ms: number) {
  try {
    window.localStorage.setItem(CROSSFADE_STORAGE, String(ms));
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
  /** IDs de video bloqueados por derechos (no reproducibles). */
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [crossfadeMs, setCrossfadeMs] = useState(2000);
  const [activeDeck, setActiveDeck] = useState<DeckId>("A");
  const durationRef = useRef(0);
  const mutedRef = useRef(false);
  const preMuteRef = useRef(80);
  /** Pedidos del público pendientes de moderación. */
  const [requests, setRequests] = useState<KaraokeRequest[]>([]);
  const [jukeboxMode, setJukeboxMode] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  /** URL pública que se codifica en el QR (editable por el DJ). */
  const [publicUrl, setPublicUrl] = useState("");

  const { settings, setSettings } = useKaraokeSettings();
  const jukeboxRef = useRef(false);
  jukeboxRef.current = jukeboxMode;



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
  const lastAdvanceRef = useRef(0);
  currentRef.current = current;
  isPlayingRef.current = isPlaying;
  volumeRef.current = volume;
  queueRef.current = queue;
  durationRef.current = duration;
  autoNextRef.current = autoNext;

  useEffect(() => {
    const saved = window.localStorage.getItem(API_KEY_STORAGE) ?? "";
    setApiKey(saved);
    setKeyDraft(saved);
    const savedAuto = window.localStorage.getItem(AUTONEXT_STORAGE);
    if (savedAuto != null) setAutoNext(savedAuto === "1");
    const savedKaraoke = window.localStorage.getItem(KARAOKE_MODE_STORAGE);
    if (savedKaraoke != null) setKaraokeMode(savedKaraoke === "1");
    const savedFade = Number(window.localStorage.getItem(CROSSFADE_STORAGE));
    if (Number.isFinite(savedFade) && savedFade >= 0) setCrossfadeMs(savedFade);
    else sendStorageCrossfade(2000);
    // Restaura la cola y la pista actual guardadas.
    try {
      const rawQueue = window.localStorage.getItem(QUEUE_STORAGE);
      if (rawQueue) {
        const parsed = JSON.parse(rawQueue) as QueueTrack[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          queueRef.current = parsed;
          setQueue(parsed);
        }
      }
      const rawCurrent = window.localStorage.getItem(CURRENT_STORAGE);
      if (rawCurrent) setCurrent(JSON.parse(rawCurrent) as QueueTrack);
    } catch {
      /* datos inválidos */
    }
  }, []);

  // URL pública para el QR: guardada por el DJ o el origen actual.
  useEffect(() => {
    const saved = window.localStorage.getItem(PUBLIC_URL_STORAGE);
    setPublicUrl(saved && saved.trim() ? saved.trim() : window.location.origin);
  }, []);



  // Persistencia inmediata de la cola y de la pista actual.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      return;
    }
    persistQueue(queue);
  }, [queue]);

  useEffect(() => {
    try {
      if (current) window.localStorage.setItem(CURRENT_STORAGE, JSON.stringify(current));
      else window.localStorage.removeItem(CURRENT_STORAGE);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [current]);


  /** Aviso discreto al DJ + marcado del video bloqueado + salto inmediato. */
  const handleEmbedError = useCallback((info: { title?: string; videoId?: string }) => {
    if (Date.now() - lastSkipRef.current < 3000) return;
    lastSkipRef.current = Date.now();
    const name = info.title || currentRef.current?.title || "La canción";
    const id = info.videoId || currentRef.current?.videoId;
    if (id) setBlockedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    toast.error(`⚠️ ${name} bloqueada por derechos. Pasando a la siguiente.`);
    setStatus(`⚠️ ${name} bloqueada por derechos. Pasando a la siguiente.`);
    window.setTimeout(() => nextRef.current(), 300);
  }, []);

  // Eventos que llegan desde la ventana de TV (latido + fin de canción)
  useEffect(() => {
    const handleEvent = (ev: TvEvent) => {
      lastAliveRef.current = ev.timestamp;
      setTvOnline(true);
      setDuration(Number.isFinite(ev.duration) && ev.duration > 1 ? ev.duration : 0);
      setElapsed(Number.isFinite(ev.currentTime) && ev.currentTime > 0 ? ev.currentTime : 0);
      setIsPlaying(ev.playing);
      if (ev.deck) setActiveDeck(ev.deck);

      if (ev.kind === "embed_error") {
        handleEmbedError({ title: ev.title ?? "", videoId: ev.videoId ?? "" });
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
        setDuration(
          Number.isFinite(data.duration) && data.duration > 1 ? data.duration : 0,
        );
        setElapsed(
          Number.isFinite(data.currentTime) && data.currentTime > 0
            ? data.currentTime
            : 0,
        );
        setIsPlaying(data.playing);
        if (data.deck) setActiveDeck(data.deck);

      }

      if (data.type === "embed_error") {
        // Video bloqueado para embeber: avisar solo al DJ y saltar
        handleEmbedError({ title: data.title, videoId: data.videoId });
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
      send({
        type: "play_video",
        videoId: track.videoId,
        title: track.title,
        ...(track.requester ? { requester: track.requester } : {}),
        ...(track.requestType ? { requestType: track.requestType } : {}),
      });
      send({ type: "play" });
      sendStorageCommand({
        action: "PLAY",
        videoId: track.videoId,
        title: track.title,
        ...(track.requester ? { requester: track.requester } : {}),
        ...(track.requestType ? { requestType: track.requestType } : {}),
        timestamp: Date.now(),
      });
      if (track.requestId) {
        void supabase
          .from("karaoke_requests")
          .update({ status: "playing" })
          .eq("id", track.requestId);
      }
      ensureTvOpen();
      setStatus(`Reproduciendo «${track.title}».`);
    },
    [send, ensureTvOpen],
  );

  const playTrackRef = useRef(playTrack);
  playTrackRef.current = playTrack;

  /** Convierte un pedido en pista y lo manda a la cola (o al aire si no hay nada). */
  const enqueueRequest = useCallback((req: KaraokeRequest) => {
    const track: QueueTrack = {
      id: `${req.video_id}-${Date.now()}`,
      videoId: req.video_id,
      title: req.song_title,
      requester: req.requester_name,
      requestId: req.id,
      requestType: req.request_type === "music_video" ? "music_video" : "karaoke",
    };
    if (!currentRef.current) {
      playTrackRef.current(track);
    } else {
      setQueue((q) => {
        const next = [...q, track];
        persistQueue(next);
        return next;
      });
    }
  }, []);

  const approveRequest = useCallback(
    async (req: KaraokeRequest) => {
      enqueueRequest(req);
      setRequests((list) => list.filter((r) => r.id !== req.id));
      await supabase
        .from("karaoke_requests")
        .update({ status: "approved" })
        .eq("id", req.id);
      toast.success(`Aprobado: ${req.song_title}`);
    },
    [enqueueRequest],
  );

  const rejectRequest = useCallback(async (req: KaraokeRequest) => {
    setRequests((list) => list.filter((r) => r.id !== req.id));
    await supabase
      .from("karaoke_requests")
      .update({ status: "rejected" })
      .eq("id", req.id);
    toast(`Rechazado: ${req.song_title}`);
  }, []);

  // Carga inicial + tiempo real de los pedidos del público
  useEffect(() => {
    const savedJukebox = window.localStorage.getItem("dj_jukebox_mode");
    if (savedJukebox != null) setJukeboxMode(savedJukebox === "1");

    let cancelled = false;
    void supabase
      .from("karaoke_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setRequests((data ?? []) as KaraokeRequest[]);
      });

    const channel = supabase
      .channel("pedidos-cabina")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "karaoke_requests" },
        (payload) => {
          const req = payload.new as KaraokeRequest;
          if (jukeboxRef.current) {
            enqueueRequest(req);
            void supabase
              .from("karaoke_requests")
              .update({ status: "approved" })
              .eq("id", req.id);
            toast.success(`🎤 ${req.requester_name} pidió: ${req.song_title}`);
          } else {
            setRequests((list) =>
              list.some((r) => r.id === req.id) ? list : [...list, req],
            );
            toast(`Nuevo pedido de ${req.requester_name}`);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [enqueueRequest]);


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

  const doSearch = async (rawQuery: string, forceExtra = false) => {
    const query = rawQuery.trim();
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
        (forceExtra || karaokeMode) && !/karaoke|live|en vivo/i.test(query)
          ? `${query} karaoke`
          : query;
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

  const runSearch = () => doSearch(searchQuery);

  /** Busca una versión alternativa (karaoke / en vivo) de una canción bloqueada. */
  const searchAlternative = (title: string) => {
    const clean = title.replace(/\s*[-–|(].*$/, "").trim() || title;
    const q = `${clean} karaoke live`;
    setSearchQuery(q);
    void doSearch(q, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveApiKey = () => {
    const trimmed = keyDraft.trim();
    window.localStorage.setItem(API_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setSettingsOpen(false);
    setStatus(trimmed ? "API Key guardada." : "API Key eliminada.");
  };

  const next = useCallback(() => {
    // Guardia: evita dobles saltos (BroadcastChannel + storage llegan juntos).
    if (Date.now() - lastAdvanceRef.current < 1200) return;
    lastAdvanceRef.current = Date.now();

    const playing = currentRef.current;
    if (playing) {
      setHistory((h) => [playing, ...h.filter((t) => t.id !== playing.id)].slice(0, 30));
      if (playing.requestId) {
        void supabase
          .from("karaoke_requests")
          .update({ status: "played" })
          .eq("id", playing.requestId);
      }
    }

    // Actualización funcional: nunca se vacía la cola, solo se extrae la cabeza.
    setQueue((prev) => {
      if (prev.length === 0) {
        queueRef.current = [];
        persistQueue([]);
        setCurrent(null);
        setIsPlaying(false);
        setDuration(0);
        setElapsed(0);
        send({ type: "clear" });
        sendStorageCommand({ action: "CLEAR", timestamp: Date.now() });
        setStatus("La cola está vacía.");
        return [];
      }
      const [head, ...rest] = prev;
      queueRef.current = rest;
      persistQueue(rest);
      playTrackRef.current(head!);
      return rest;
    });
  }, [send]);

  /** Salto en la barra de tiempo: envía SEEK_TO a la TV al instante. */
  const seekTo = useCallback(
    (seconds: number) => {
      const target = Math.max(0, Math.min(seconds, durationRef.current || seconds));
      setElapsed(target);
      send({ type: "seek", seconds: target });
      sendStorageCommand({ action: "SEEK_TO", seconds: target, timestamp: Date.now() });
    },
    [send],
  );

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
    <main className="flex min-h-screen w-full flex-col gap-4 bg-background p-4 text-foreground">
      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:items-center md:justify-between">
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
          <Button size="lg" variant="outline" onClick={() => setQrOpen(true)}>
            <QrCode className="size-5" />
            Código QR Clientes
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

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">


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
            <ul className="mt-4 max-h-[260px] space-y-2 overflow-y-auto pr-2 scrollbar-thin">
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
              {duration > 1
                ? `${formatTime(elapsed)} / ${formatTime(duration)}`
                : "0:00 / Cargando…"}
            </p>
          </div>
          <div className="mt-4">
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={1}
              value={duration > 1 ? Math.min(Math.floor(elapsed), Math.floor(duration)) : 0}
              disabled={duration <= 1}
              aria-label="Barra de tiempo"
              onChange={(e) => seekTo(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundImage: `linear-gradient(to right, var(--color-primary) ${
                  duration > 1 ? Math.min(100, (elapsed / duration) * 100) : 0
                }%, var(--color-secondary) 0%)`,
              }}
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

          <div className="mt-4 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Duración de crossfade</span>
              <div className="ml-auto flex items-center gap-2 text-xs">
                {(["A", "B"] as const).map((deck) => (
                  <span
                    key={deck}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono transition-colors ${
                      activeDeck === deck
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-2 rounded-full ${
                        activeDeck === deck
                          ? "bg-primary shadow-glow"
                          : "bg-muted-foreground/40"
                      }`}
                    />
                    Deck {deck}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {CROSSFADE_OPTIONS.map((opt) => (
                <Button
                  key={opt.ms}
                  size="sm"
                  variant={crossfadeMs === opt.ms ? "default" : "outline"}
                  onClick={() => {
                    setCrossfadeMs(opt.ms);
                    sendStorageCrossfade(opt.ms);
                    send({ type: "crossfade", ms: opt.ms });
                    setStatus(`Crossfade: ${opt.label}`);
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
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

        <div className="flex min-w-0 flex-col gap-4">
        <section className="panel-surface rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Bandeja de pedidos
            </h2>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
              {requests.length}
            </span>
          </div>

          <div className="mt-3 space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center gap-3">
              <Switch
                id="requests-open"
                checked={settings?.requests_open ?? false}
                onCheckedChange={(checked) => {
                  setSettings((prev) => (prev ? { ...prev, requests_open: checked } : prev));
                  void saveSettings({ requests_open: checked });
                }}
              />
              <Label htmlFor="requests-open" className="text-sm">
                Recepción de pedidos
                <span className="block text-xs text-muted-foreground">
                  {settings?.requests_open ? "Abierta" : "Cerrada"}
                </span>
              </Label>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="daily-pin" className="text-xs text-muted-foreground">
                  PIN del día
                </Label>
                <Input
                  id="daily-pin"
                  value={settings?.daily_pin ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSettings((prev) => (prev ? { ...prev, daily_pin: value } : prev));
                  }}
                  onBlur={() => {
                    if (settings?.daily_pin) void saveSettings({ daily_pin: settings.daily_pin });
                  }}
                  className="mt-1 tracking-[0.3em]"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  const pin = randomPin();
                  setSettings((prev) => (prev ? { ...prev, daily_pin: pin } : prev));
                  void saveSettings({ daily_pin: pin });
                }}
              >
                Generar
              </Button>
            </div>
          </div>


          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border p-3">
            <Switch
              id="jukebox-mode"
              checked={jukeboxMode}
              onCheckedChange={(checked) => {
                setJukeboxMode(checked);
                window.localStorage.setItem("dj_jukebox_mode", checked ? "1" : "0");
              }}
            />
            <Label htmlFor="jukebox-mode" className="text-sm">
              Modo Rocola Automática
              <span className="block text-xs text-muted-foreground">
                {jukeboxMode
                  ? "Los pedidos entran solos a la cola"
                  : "Modo moderado: tú apruebas cada pedido"}
              </span>
            </Label>
          </div>

          <ul className="mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-2 scrollbar-thin">
            {requests.length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                Sin pedidos del público por ahora.
              </li>
            )}
            {requests.map((req) => (
              <li
                key={req.id}
                className="flex gap-2 rounded-xl border border-border bg-card p-2"
              >
                {req.thumbnail_url && (
                  <img
                    src={req.thumbnail_url}
                    alt={`Miniatura de ${req.song_title}`}
                    loading="lazy"
                    className="h-12 w-20 shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-primary">
                      {req.requester_name}
                    </p>
                    <TypeBadge type={req.request_type} />
                  </div>
                  <p className="line-clamp-2 text-sm">{req.song_title}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => void approveRequest(req)}>
                      Aprobar (+ Cola)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void rejectRequest(req)}
                    >
                      Rechazar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>


        <section className="panel-surface rounded-2xl p-5">

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

          <ul className="mt-4 max-h-[380px] space-y-2 overflow-y-auto pr-2 scrollbar-thin">
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
                <span className="min-w-0 flex-1 truncate text-sm">
                  {track.requestType && (
                    <TypeBadge type={track.requestType} />
                  )}{" "}
                  {track.title}
                  {blockedIds.includes(track.videoId) && (
                    <span className="ml-2 rounded-full border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                      No reproducible / Restringida
                    </span>
                  )}
                </span>
                {blockedIds.includes(track.videoId) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs"
                    onClick={() => searchAlternative(track.title)}
                  >
                    Buscar versión Karaoke / En vivo
                  </Button>
                )}
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
                      {blockedIds.includes(track.videoId) && (
                        <span className="ml-2 rounded-full border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                          No reproducible / Restringida
                        </span>
                      )}
                    </span>
                    {blockedIds.includes(track.videoId) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs"
                        onClick={() => searchAlternative(track.title)}
                      >
                        Buscar versión Karaoke / En vivo
                      </Button>
                    ) : (
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
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
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

      {qrOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
            <h2 className="text-lg font-semibold">Pedidos del público</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Que tus clientes escaneen este código para pedir canciones.
            </p>
            {(() => {
              const base = (publicUrl || "").trim().replace(/\/+$/, "");
              const link = `${base}/pedir${apiKey ? `?k=${encodeURIComponent(apiKey)}` : ""}`;
              return (
                <>
                  <div className="mt-4 text-left">
                    <Label htmlFor="public-url" className="text-xs">
                      URL Base Pública
                    </Label>
                    <Input
                      id="public-url"
                      value={publicUrl}
                      placeholder="https://tu-proyecto.lovable.app"
                      onChange={(e) => {
                        setPublicUrl(e.target.value);
                        try {
                          window.localStorage.setItem(PUBLIC_URL_STORAGE, e.target.value);
                        } catch {
                          /* almacenamiento no disponible */
                        }
                      }}
                      className="mt-1"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Usa tu dominio publicado para que los clientes no vean “Access denied”.
                    </p>
                  </div>
                  <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-4">
                    <QRCodeSVG value={link} size={240} />
                  </div>
                  <p className="mt-3 break-all text-xs text-muted-foreground">{`${base}/pedir`}</p>
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          toast.success("Enlace copiado");
                        } catch {
                          toast.error("No se pudo copiar el enlace");
                        }
                      }}
                    >
                      Copiar enlace
                    </Button>
                  </div>
                </>
              );
            })()}

            <div className="mt-5 flex justify-center gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                Imprimir
              </Button>
              <Button onClick={() => setQrOpen(false)}>Cerrar</Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
