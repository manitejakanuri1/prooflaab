-- Timestamps for spoken explanations (17 Sep 2026).
-- The browser transcriber already produces "0:04-0:09 First I opened the
-- interpreter..." per stretch of speech; the app threw that away and kept only
-- the flat text. This keeps it, so a recording can be read and played side by
-- side. Additive and nullable: existing rows are untouched.
begin;

alter table public.voice_explanations
  add column if not exists transcript_segments jsonb;

comment on column public.voice_explanations.transcript_segments is
  'Array of {start, end, text} in seconds from the start of the recording, from the browser transcriber.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'voice_explanations'
                    and column_name = 'transcript_segments') then
    raise exception 'transcript_segments was not added';
  end if;
end $$;

commit;
