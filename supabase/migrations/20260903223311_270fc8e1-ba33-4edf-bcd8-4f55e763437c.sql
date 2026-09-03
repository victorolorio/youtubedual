CREATE TABLE public.karaoke_settings (
  id text PRIMARY KEY DEFAULT 'main',
  requests_open boolean NOT NULL DEFAULT true,
  daily_pin text NOT NULL DEFAULT '1234',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.karaoke_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.karaoke_settings TO authenticated;
GRANT ALL ON public.karaoke_settings TO service_role;

ALTER TABLE public.karaoke_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can read settings" ON public.karaoke_settings FOR SELECT USING (true);
CREATE POLICY "public can update settings" ON public.karaoke_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public can insert settings" ON public.karaoke_settings FOR INSERT WITH CHECK (true);

INSERT INTO public.karaoke_settings (id, requests_open, daily_pin) VALUES ('main', true, '1234');

ALTER TABLE public.karaoke_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.karaoke_settings;