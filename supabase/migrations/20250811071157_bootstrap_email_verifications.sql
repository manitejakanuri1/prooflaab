-- Bootstrap: table created outside migration history in the original project.
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text DEFAULT 'user email address'::text,
  code text DEFAULT '6-digit code'::text,
  created_at timestamp without time zone DEFAULT now(),
  is_verified boolean DEFAULT false,
  CONSTRAINT email_verifications_pkey PRIMARY KEY (id)
);

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
