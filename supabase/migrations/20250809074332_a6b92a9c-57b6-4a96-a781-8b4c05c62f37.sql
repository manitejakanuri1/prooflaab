-- Fix storage policies for profile-photos bucket
-- First check existing policies
DROP POLICY IF EXISTS "Users can view their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;

-- Create proper storage policies for profile-photos bucket
CREATE POLICY "Users can view profile photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'profile-photos');

CREATE POLICY "Users can upload their own profile photos" 
ON storage.objects FOR INSERT 
WITH CHECK (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own profile photos" 
ON storage.objects FOR UPDATE 
USING (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own profile photos" 
ON storage.objects FOR DELETE 
USING (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);