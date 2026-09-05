import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, ListMusic, Loader2, Lock, Music4, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { PIN_SESSION_STORAGE, useKaraokeSettings } from "@/lib/karaoke-settings";
import {
  searchYouTube,
  type RequestType,
  type YouTubeSearchResult,
} from "@/lib/tv-channel";

const NAME_STORAGE = "pedir_nombre";
const KEY_STORAGE = "youtube_api_key";
const TYPE_STORAGE = "pedir_tipo";

export const Route = createFileRoute("/pedir")({
  head: () => ({
    meta: [
      { title: "Pide tu Canción — Karaoke en Vivo" },
      {
        name: "description",
        content:
          "Busca tu canción favorita y envíala directo a la cabina del DJ desde tu celular. Sigue el estado de tus pedidos en vivo.",
      },
      { property: "og:title", content: "Pide tu Canción — Karaoke en Vivo" },
      {
        property: "og:description",
        content: "Envía tu canción a la cabina del DJ desde tu celular.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RequestPage,
});

type RequestRow = {
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

const STATUS_LABEL: Record<string, string> = {
  pending: "En espera",
  approved: "Aprobado",
  playing: "Sonando",
  rejected: "Rechazado",
};

function RequestPage() {
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<RequestRow[]>([]);
  const [tab, setTab] = useState<"buscar" | "mis">("buscar");
  const [sent, setSent] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>("karaoke");
  const [sending, setSending] = useState<string | null>(null);
  const { settings, loading: settingsLoading } = useKaraokeSettings();
  const [pinDraft, setPinDraft] = useState("");
  const [pinOk, setPinOk] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    setPinOk(window.localStorage.getItem(PIN_SESSION_STORAGE) !== null);
  }, []);

  // Si el DJ cambia el PIN, la sesión guardada deja de valer.
  useEffect(() => {
    if (!settings) return;
    const saved = window.localStorage.getItem(PIN_SESSION_STORAGE);
    if (saved && saved !== settings.daily_pin) {
      window.localStorage.removeItem(PIN_SESSION_STORAGE);
      setPinOk(false);
    }
  }, [settings]);


  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_STORAGE) ?? "";
    setName(saved);
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("k");
    if (fromUrl) window.localStorage.setItem(KEY_STORAGE, fromUrl);
    setApiKey(fromUrl ?? window.localStorage.getItem(KEY_STORAGE) ?? "");
    const savedType = window.localStorage.getItem(TYPE_STORAGE);
    if (savedType === "music_video" || savedType === "karaoke") setRequestType(savedType);
  }, []);

  const loadMine = useCallback(async (who: string) => {
    if (!who) return;
    const { data } = await supabase
      .from("karaoke_requests")
      .select("*")
      .eq("requester_name", who)
      .order("created_at", { ascending: false })
      .limit(20);
    setMine((data ?? []) as RequestRow[]);
  }, []);

  useEffect(() => {
    if (!name) return;
    void loadMine(name);
    const channel = supabase
      .channel("mis-pedidos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "karaoke_requests" },
        () => void loadMine(name),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [name, loadMine]);

  const pendingCount = mine.filter((r) => r.status === "pending").length;

  const buildQuery = (raw: string) => {
    if (requestType === "karaoke") {
      return /karaoke/i.test(raw) ? raw : `${raw} karaoke`;
    }
    return /(video oficial|official video|videoclip)/i.test(raw)
      ? raw
      : `${raw} video oficial`;
  };

  const runSearch = async () => {
    const raw = query.trim();
    if (!raw) return;
    if (!apiKey) {
      setError("Pide al DJ que comparta el código QR actualizado para habilitar la búsqueda.");
      return;
    }
    const q = buildQuery(raw);
    setSearching(true);
    setError(null);
    try {
      setResults(await searchYouTube(q, apiKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo buscar.");
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (r: YouTubeSearchResult) => {
    if (pendingCount >= 2) {
      setError("Ya tienes pedidos en espera. Espera a que suene tu turno para pedir más");
      return;
    }
    setSending(r.videoId);
    const { error: insertError } = await supabase.from("karaoke_requests").insert({
      requester_name: name,
      video_id: r.videoId,
      song_title: r.title,
      song_channel: r.channel,
      thumbnail_url: r.thumbnail,
      status: "pending",
      request_type: requestType,
    });
    setSending(null);
    if (insertError) {
      setError("No se pudo enviar tu pedido. Intenta otra vez.");
      return;
    }
    setError(null);
    setSent(true);
    window.setTimeout(() => setSent(false), 2200);
    void loadMine(name);
  };

  if (settingsLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </main>
    );
  }

  if (settings && !settings.requests_open) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-8 text-center">
          <Lock className="mx-auto size-10 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Cabina cerrada</h1>
          <p className="text-sm text-muted-foreground">
            La cabina de pedidos está cerrada en este momento. Vuelve a intentarlo más tarde.
          </p>
        </div>
      </main>
    );
  }

  if (settings && !pinOk) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 text-center">
          <Lock className="mx-auto size-10 text-primary" />
          <h1 className="text-2xl font-bold">PIN del día</h1>
          <p className="text-sm text-muted-foreground">
            Ingresa el PIN que aparece en la pantalla del local para poder pedir canciones.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = pinDraft.trim();
              if (value.toLowerCase() !== settings.daily_pin.trim().toLowerCase()) {
                setPinError("PIN incorrecto. Míralo en la pantalla del local.");
                return;
              }
              window.localStorage.setItem(PIN_SESSION_STORAGE, settings.daily_pin);
              setPinError(null);
              setPinOk(true);
            }}
          >
            <Input
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value)}
              placeholder="PIN"
              aria-label="PIN del día"
              inputMode="text"
              className="h-12 text-center text-lg tracking-[0.4em]"
            />
            {pinError && <p className="text-sm text-destructive">{pinError}</p>}
            <Button type="submit" size="lg" className="w-full shadow-glow">
              Entrar
            </Button>
          </form>
        </div>
      </main>
    );
  }

  if (!name) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card p-6 text-center">
          <Music4 className="mx-auto size-10 text-primary" />
          <h1 className="text-2xl font-bold">Pide tu canción</h1>
          <p className="text-sm text-muted-foreground">
            Escribe tu nombre o el número de tu mesa para empezar.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = nameDraft.trim();
              if (!value) return;
              window.localStorage.setItem(NAME_STORAGE, value);
              setName(value);
            }}
          >
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Tu nombre o Mesa"
              aria-label="Tu nombre o mesa"
              className="h-12 text-center text-base"
            />
            <Button type="submit" size="lg" className="w-full shadow-glow">
              Continuar
            </Button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold">Karaoke en vivo</h1>
        <p className="text-xs text-muted-foreground">Pidiendo como {name}</p>
      </header>

      {tab === "buscar" ? (
        <section className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1">
            {(
              [
                { key: "karaoke", label: "🎤 Karaoke", hint: "Modo cantar" },
                { key: "music_video", label: "🎬 Video Musical", hint: "Modo fiesta" },
              ] as Array<{ key: RequestType; label: string; hint: string }>
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setRequestType(opt.key);
                  window.localStorage.setItem(TYPE_STORAGE, opt.key);
                }}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  requestType === opt.key
                    ? "bg-primary text-primary-foreground shadow-glow"
                    : "text-muted-foreground"
                }`}
              >
                {opt.label}
                <span className="block text-[10px] font-normal opacity-80">{opt.hint}</span>
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busca tu canción o artista"
              aria-label="Buscar canción"
              className="h-12"
            />
            <Button type="submit" size="lg" disabled={searching}>
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            </Button>
          </form>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <ul className="space-y-3">
            {results.map((r) => (
              <li
                key={r.videoId}
                className="flex gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <img
                  src={r.thumbnail}
                  alt={`Miniatura de ${r.title}`}
                  loading="lazy"
                  className="h-16 w-28 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.channel}</p>
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    disabled={sending === r.videoId}
                    onClick={() => void sendRequest(r)}
                  >
                    <Plus className="size-4" />
                    Pedir esta canción
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="space-y-3 px-4 py-4">
          {mine.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Todavía no has pedido canciones.
            </p>
          )}
          {mine.map((r) => (
            <div key={r.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
              <img
                src={r.thumbnail_url}
                alt={`Miniatura de ${r.song_title}`}
                loading="lazy"
                className="h-14 w-24 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium">{r.song_title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-xs ${
                      r.status === "approved" || r.status === "playing"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {r.status === "approved" || r.status === "playing"
                      ? "Aprobado — Esperando turno en cabina"
                      : (STATUS_LABEL[r.status] ?? r.status)}
                  </span>
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                      r.request_type === "music_video"
                        ? "bg-cyan-500/20 text-cyan-300"
                        : "bg-violet-500/20 text-violet-300"
                    }`}
                  >
                    {r.request_type === "music_video" ? "🎬 Video" : "🎤 Karaoke"}
                  </span>
                </div>
                {r.status === "pending" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={cancelling === r.id}
                    onClick={() => void cancelRequest(r.id)}
                  >
                    {cancelling === r.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Cancelar pedido
                  </Button>
                )}
              </div>

            </div>
          ))}
        </section>
      )}

      {sent && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur">
          <div className="tv-ticker flex flex-col items-center gap-3 rounded-3xl border border-primary/40 bg-card px-10 py-8 text-center shadow-glow">
            <Check className="size-12 text-primary" />
            <p className="text-xl font-bold">
              {requestType === "karaoke"
                ? "🎤 ¡Petición de Karaoke enviada! Prepárate para cantar cuando te llamen."
                : "🎬 ¡Video Musical enviado a la lista de reproducción!"}
            </p>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-border bg-card">
        <button
          type="button"
          onClick={() => setTab("buscar")}
          className={`flex flex-col items-center gap-1 py-3 text-xs ${
            tab === "buscar" ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <Search className="size-5" />
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setTab("mis")}
          className={`flex flex-col items-center gap-1 py-3 text-xs ${
            tab === "mis" ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <ListMusic className="size-5" />
          Mis Pedidos {pendingCount > 0 && `(${pendingCount})`}
        </button>
      </nav>
    </main>
  );
}
