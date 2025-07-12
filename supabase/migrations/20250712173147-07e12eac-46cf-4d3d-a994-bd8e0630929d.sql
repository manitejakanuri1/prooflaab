-- Update the moss_status check constraint to include 'Error'
ALTER TABLE public.proof_uploads 
DROP CONSTRAINT IF EXISTS proof_uploads_moss_status_check;

ALTER TABLE public.proof_uploads 
ADD CONSTRAINT proof_uploads_moss_status_check 
CHECK (moss_status IN ('Pending', 'Unique', 'Similar', 'Suspicious', 'Error'));