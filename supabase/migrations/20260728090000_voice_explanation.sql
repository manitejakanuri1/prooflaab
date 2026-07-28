-- Voice defense: after the timed quiz, the student records ONE short voice
-- explanation of why they answered the way they did. AI checks whether the
-- explanation actually matches their specific answers, to catch guessing/fluke.

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-explanations', 'voice-explanations', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Students can upload their own voice explanation"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'voice-explanations' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can view their own voice explanation"
ON storage.objects FOR SELECT
USING (bucket_id = 'voice-explanations' AND auth.uid()::text = (storage.foldername(name))[1]);

ALTER TABLE public.resume_scorecards
  ADD COLUMN voice_authenticity_score numeric,
  ADD COLUMN voice_notes text;
