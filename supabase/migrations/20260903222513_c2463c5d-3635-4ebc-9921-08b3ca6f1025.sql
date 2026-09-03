CREATE TABLE public.karaoke_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_name text NOT NULL,
  video_id text NOT NULL,
  song_title text NOT NULL,
  song_channel text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.karaoke_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.karaoke_requests TO authenticated;
GRANT ALL ON public.karaoke_requests TO service_role;

ALTER TABLE public.karaoke_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can read requests" ON public.karaoke_requests FOR SELECT USING (true);
CREATE POLICY "public can create requests" ON public.karaoke_requests FOR INSERT WITH CHECK (status = 'pending');
CREATE POLICY "public can moderate requests" ON public.karaoke_requests FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public can delete requests" ON public.karaoke_requests FOR DELETE USING (true);

CREATE INDEX karaoke_requests_status_created_idx ON public.karaoke_requests (status, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.karaoke_requests;
ALTER TABLE public.karaoke_requests REPLICA IDENTITY FULL;