-- Bootstrap: table created outside migration history in the original project.
-- Depends on public.app_role, created in 20250811071029.
CREATE TABLE IF NOT EXISTS public.invite_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  role public.app_role NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  used_by uuid REFERENCES auth.users(id),
  expires_at timestamp with time zone NOT NULL,
  is_used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invite_codes_pkey PRIMARY KEY (id)
);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
