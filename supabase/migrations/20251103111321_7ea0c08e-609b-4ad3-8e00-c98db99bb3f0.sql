-- Add AI verification summary columns to proof_uploads table
ALTER TABLE proof_uploads 
ADD COLUMN IF NOT EXISTS ai_score numeric,
ADD COLUMN IF NOT EXISTS ai_summary text,
ADD COLUMN IF NOT EXISTS ai_feedback text,
ADD COLUMN IF NOT EXISTS ai_status text;