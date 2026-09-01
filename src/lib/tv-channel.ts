export const TV_CHANNEL_NAME = "youtube_tv_channel";

/** Claves compartidas de localStorage para sincronizar consola <-> TV. */
export const COMMAND_STORAGE = "tv_player_command";
export const VOLUME_STORAGE = "tv_player_volume";
export const EVENT_STORAGE = "tv_player_event";

export type TvCommand =
  | { action: "PLAY"; videoId: string; title?: string; timestamp: number }
  | { action: "PAUSE"; timestamp: number }
  | { action: "RESTART"; timestamp: number }
  | { action: "MESSAGE"; text: string; timestamp: number }
  | { action: "CLEAR"; timestamp: number };

/** Eventos que la TV envía de vuelta a la consola. */
export type TvEvent = {
  kind: "heartbeat" | "ended";
  duration: number;
  currentTime: number;
  playing: boolean;
  timestamp: number;
};


export type QueueTrack = {
  id: string;
  videoId: string;
  title: string;
};

export type TvMessage =
  | { type: "play_video"; videoId: string; title: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "restart" }
  | { type: "volume"; volume: number }
  | { type: "message"; text: string }
  | { type: "clear" }
  | { type: "request_state" }
  | { type: "embed_error"; videoId: string; title: string; code: number }
  | { type: "state"; duration: number; currentTime: number; playing: boolean };

export function createTvChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  return new BroadcastChannel(TV_CHANNEL_NAME);
}

/** Accepts a full YouTube URL or a raw 11-char video ID. */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const match = url.pathname.match(/\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (match?.[2]) return match[2];
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}`,
    );
    if (!res.ok) throw new Error("oembed failed");
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || `Video ${videoId}`;
  } catch {
    return `Video ${videoId}`;
  }
}

export type YouTubeSearchResult = {
  videoId: string;
  title: string;
  thumbnail: string;
  channel: string;
};

export async function searchYouTube(
  query: string,
  apiKey: string,
): Promise<YouTubeSearchResult[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(
    query,
  )}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? `Error ${res.status} de YouTube API`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }>;
  };
  return (data.items ?? [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id!.videoId!,
      title: item.snippet?.title ?? "Sin título",
      channel: item.snippet?.channelTitle ?? "",
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        "",
    }));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
