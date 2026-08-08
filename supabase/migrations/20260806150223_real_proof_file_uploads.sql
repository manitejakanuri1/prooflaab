-- Proof files were never actually uploaded.
--
-- The upload modal wrote the string "[FILE: report.pdf (application/pdf, 12345
-- bytes)]" into file_url and dropped the file on the floor. Every reviewer view
-- renders file_url as an href, so the "open the proof" link pointed at that
-- literal text and there was nothing behind it. A platform whose entire promise
-- is verified proof of work was accepting a filename as proof.
--
-- Private on purpose: a proof can be coursework, a CV, a screenshot of internal
-- work. Access goes through the proof-file-url function, which applies the same
-- rules as the proof_uploads SELECT policy rather than trusting an unguessable
-- URL to keep it private.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proofs', 'proofs', false, 10485760,
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'video/mp4','video/quicktime','video/x-msvideo','video/x-matroska',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = false;

-- Students write and read inside their own folder, exactly like resumes. The
-- 10MB ceiling and the type list live on the bucket, so a student who bypasses
-- the browser checks is refused by storage itself rather than by good manners.
CREATE POLICY "Students can upload their own proof file"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proofs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can view their own proof file"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proofs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can replace their own proof file"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'proofs' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Reviewers deliberately get no storage policy. They reach a file through
-- proof-file-url, which checks whether they may see that particular proof
-- before signing anything — a storage policy cannot express "the startup that
-- owns the task this proof belongs to".

-- Where the file actually lives. Kept apart from file_url rather than overloading
-- it: file_url is a link the student pasted and is also what the GitHub repo
-- detection reads, and mixing a storage path into it is what produced the fake
-- "[FILE: ...]" value in the first place.
ALTER TABLE public.proof_uploads
  ADD COLUMN file_path TEXT,
  ADD COLUMN file_name TEXT,
  ADD COLUMN file_size BIGINT,
  ADD COLUMN file_type TEXT;;
