-- Add review flags and reviewer tracking to proof_uploads
ALTER TABLE public.proof_uploads 
ADD COLUMN IF NOT EXISTS review_flag BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS review_override_reason TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;

-- Create index for faster queries on review_flag
CREATE INDEX IF NOT EXISTS idx_proof_uploads_review_flag ON public.proof_uploads(review_flag);

-- Add comment for documentation
COMMENT ON COLUMN public.proof_uploads.review_flag IS 'Indicates if proof requires manual review (true when trust score < 10)';
COMMENT ON COLUMN public.proof_uploads.reviewer_id IS 'User ID of college admin who reviewed the proof';
COMMENT ON COLUMN public.proof_uploads.review_override_reason IS 'Reason for manual override decision';
COMMENT ON COLUMN public.proof_uploads.reviewed_by_name IS 'Name of reviewer for audit trail';