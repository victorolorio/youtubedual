import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type KaraokeSettings = {
  requests_open: boolean;
  daily_pin: string;
};

export const SETTINGS_ID = "main";
export const PIN_SESSION_STORAGE = "pedir_pin_ok";

export async function fetchSettings(): Promise<KaraokeSettings | null> {
  const { data } = await supabase
    .from("karaoke_settings")
    .select("requests_open, daily_pin")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  return (data as KaraokeSettings | null) ?? null;
}

export async function saveSettings(patch: Partial<KaraokeSettings>) {
  await supabase
    .from("karaoke_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", SETTINGS_ID);
}

export function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Configuración de cabina en vivo (se actualiza sola vía Realtime). */
export function useKaraokeSettings() {
  const [settings, setSettings] = useState<KaraokeSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetchSettings().then((data) => {
      if (!active) return;
      setSettings(data);
      setLoading(false);
    });

    const channel = supabase
      .channel("karaoke-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "karaoke_settings" },
        (payload) => {
          const row = payload.new as KaraokeSettings | undefined;
          if (row && typeof row.daily_pin === "string") setSettings(row);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  return { settings, loading, setSettings };
}
