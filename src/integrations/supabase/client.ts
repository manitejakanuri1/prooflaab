/**
 * The client every screen imports.
 *
 * The folder is still called `supabase` because 152 files import from this path,
 * and renaming it would be 152 edits for no behavioural gain. What it returns is
 * Google: Cloud SQL through PostgREST, Identity Platform for logins, Cloud
 * Storage for files, and the 41 functions on Cloud Run.
 *
 * There used to be a switch here, and a Supabase client beside it, so the move
 * could be undone with one environment variable. The Supabase project was
 * deleted on 13 September 2026, so that path no longer led anywhere: had
 * VITE_BACKEND ever gone missing, every screen would have quietly aimed at a
 * project that returns 410 Gone. A fallback to something that does not exist is
 * worse than no fallback, because it fails as a puzzle rather than as an error.
 *
 * The way back now is the backup, not a flag:
 *   gs://prooflab-backups-508214  - 12 September for the structure, restored and
 *   verified at the time; 13 September for Supabase's final contents.
 */
import { createGoogleClient } from '@/integrations/google/client';

// Import the client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = createGoogleClient();
