-- Add ethical framing columns to proof_uploads table
ALTER TABLE public.proof_uploads
ADD COLUMN IF NOT EXISTS declaration_acknowledged boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS declaration_text text,
ADD COLUMN IF NOT EXISTS reflection_requested boolean DEFAULT false;

COMMENT ON COLUMN public.proof_uploads.declaration_acknowledged IS 'Student confirmed work reflects their understanding';
COMMENT ON COLUMN public.proof_uploads.declaration_text IS 'Optional declaration of who helped (e.g., mentor, peer)';
COMMENT ON COLUMN public.proof_uploads.reflection_requested IS 'Student requested mentor review for conceptual understanding';