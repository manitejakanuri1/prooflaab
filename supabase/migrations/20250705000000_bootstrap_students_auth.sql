-- Bootstrap: table created outside migration history in the original project.
-- Reconstructed so migrations can run against an empty database.
CREATE TABLE IF NOT EXISTS public.students_auth (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text DEFAULT 'required'::text,
  is_verified boolean,
  verification_code text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT students_auth_pkey PRIMARY KEY (id)
);

ALTER TABLE public.students_auth ENABLE ROW LEVEL SECURITY;
