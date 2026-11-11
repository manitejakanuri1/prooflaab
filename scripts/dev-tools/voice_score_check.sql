-- READ ONLY (QA round 2 items 22 and 27, 11 Nov 2026). Changes nothing.
-- Part 1 (item 22): short or thin recordings that still scored high, with what the grader stored.
--   dur = recording length the browser sent (null = unknown, which skips the 20-second rule),
--   speech = seconds of real speech the voice detector heard, match = content_match (is the talk about this work).
-- Part 2 (item 27): recordings whose transcript stops well before the recording ends (transcript cut short).
\pset pager off
select left(v.id::text, 8) as id, v.created_at::date as day, left(sp.full_name, 20) as student, left(t.title, 40) as lot,
       v.duration_seconds as dur, round((v.evaluation -> 'transcription' ->> 'speech_seconds')::numeric, 1) as speech,
       v.word_count as words, v.communication_score as score, v.evaluation ->> 'content_match' as match,
       left(v.transcript, 120) as said, left(v.communication_notes, 120) as notes
  from public.voice_explanations v
  join public.tasks t on t.id = v.task_id
  left join public.student_profiles sp on sp.id = v.student_id
 where v.status = 'scored' and v.withdrawn_at is null
   and v.created_at > now() - interval '14 days'
   and (v.duration_seconds is null or v.duration_seconds < 30 or coalesce(v.word_count, 0) < 60
        or coalesce((v.evaluation -> 'transcription' ->> 'speech_seconds')::numeric, 99) < 30)
 order by v.communication_score desc nulls last, v.created_at desc
 limit 40;

select left(v.id::text, 8) as id, v.created_at::date as day, left(sp.full_name, 20) as student,
       v.duration_seconds as dur, round((v.transcript_segments -> -1 ->> 'end')::numeric, 1) as transcript_ends_at,
       jsonb_array_length(coalesce(v.transcript_segments, '[]'::jsonb)) as segments, v.word_count as words,
       round((v.evaluation -> 'transcription' ->> 'speech_seconds')::numeric, 1) as speech, v.transcript_source as source
  from public.voice_explanations v
  left join public.student_profiles sp on sp.id = v.student_id
 where v.created_at > now() - interval '14 days' and v.duration_seconds >= 40
   and coalesce((v.transcript_segments -> -1 ->> 'end')::numeric, 0) < v.duration_seconds * 0.6
 order by v.created_at desc
 limit 40;
