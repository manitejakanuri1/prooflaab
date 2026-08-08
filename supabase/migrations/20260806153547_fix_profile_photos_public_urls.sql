-- Profile photos were uploaded successfully and then never displayed.
--
-- The upload code calls getPublicUrl, which builds a /object/public/... URL, but
-- that endpoint only serves buckets flagged public — and this one was not. Every
-- avatar URL stored in the database answers "Bucket not found". The intent was
-- always public: the bucket already carries a "Profile photos are publicly
-- accessible" SELECT policy for everyone, so the flag was simply never set.
--
-- Flipping the flag repairs every URL already saved, with no code change and no
-- re-upload.
UPDATE storage.buckets
   SET public = true,
       -- No limits at all until now, so a 2GB "avatar" was accepted.
       file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
 WHERE id = 'profile-photos';;
