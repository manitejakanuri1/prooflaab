-- Rollback of 69: removes the language decision functions. Put the previous transcriber and worker
-- images back first (the new worker calls set_transcription_language). Stored language metadata stays.
drop function if exists public.set_transcription_language(uuid, uuid, jsonb, boolean);
drop function if exists public.voice_not_english(uuid);
notify pgrst, 'reload schema';
