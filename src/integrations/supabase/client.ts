// The generated constants below are still the Supabase project's. Do not edit
// them by hand - they are regenerated. Everything after them is the backend
// switch and is safe to keep.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createGoogleClient } from '@/integrations/google/client';

const SUPABASE_URL = "https://ajaeneehxlnmnhjtvrgs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqYWVuZWVoeGxubW5oanR2cmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTMyMDIsImV4cCI6MjEwMDEyOTIwMn0.88txEo8swR4bhvVBXAw5AgnEAtrZOZI4Jn1_zcxr7RY";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

const supabaseClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

/**
 * Which backend the app talks to.
 *
 * Set VITE_BACKEND=google to log in against Google Identity Platform and read
 * the database through PostgREST on Cloud Run. Anything else - including the
 * variable being absent - keeps Supabase, so a deploy that forgets the variable
 * behaves exactly as it does today rather than failing in a new way.
 *
 * The switch lives here, in the one module all 43 auth-using files already
 * import, so moving provider does not mean editing 80 call sites. Flipping it
 * back is a single environment variable and a redeploy, which is what makes the
 * cutover reversible within minutes.
 *
 * Do not flip it until phases 5 and 6 are done: file uploads and the 24 edge
 * functions that verify a token still expect a Supabase session.
 */
const USE_GOOGLE = import.meta.env.VITE_BACKEND === 'google';

export const supabase = USE_GOOGLE ? createGoogleClient() : supabaseClient;
