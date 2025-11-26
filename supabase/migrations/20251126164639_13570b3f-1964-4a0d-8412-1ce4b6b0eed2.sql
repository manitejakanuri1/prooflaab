-- Make proof_id nullable to support external projects
ALTER TABLE proof_posts 
ALTER COLUMN proof_id DROP NOT NULL;