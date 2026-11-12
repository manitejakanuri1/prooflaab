-- 255 (owner 12 Nov 2026, assigned-work test item 4): the length rule follows the task text.
--   A college task said "In 3-4 sentences" but the shared fallback checker asked for 100-200 words; a company
--   task showed "about 20-3000 words". task_word_range(title, description, stored min, stored max): a range the
--   task text states (N-M words, N-M sentences = 8-30 words each, about N words) wins; otherwise the stored range,
--   with a nonsense range (over 1500, or wider than 20x) capped. Used by rubric_task_view (every student screen)
--   and by submit-written-task (the word check). Fixes existing rows too - nothing stored is rewritten.
-- Rollback: migration/255-rollback-task-word-range.sql
begin;
create or replace function public.task_word_range(_title text, _description text, _min integer, _max integer)
returns jsonb language plpgsql immutable set search_path to 'public', 'pg_temp' as $f$
declare
  t text := lower(coalesce(_title, '') || ' ' || coalesce(_description, ''));
  n text := '(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)';
  m text[];
  lo integer; hi integer;
  num constant text[] := array['one','two','three','four','five','six','seven','eight','nine','ten'];
begin
  -- "100 to 150 words", "100-150 words"
  m := regexp_match(t, '(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\s*words?');
  if m is not null then
    lo := m[1]::int; hi := m[2]::int;
  else
    -- "3-4 sentences", "three to four sentences", "5 sentences": about 8 to 30 words a sentence
    m := regexp_match(t, n || '\s*(?:-|–|to|or)\s*' || n || '\s*sentences?');
    if m is null then m := regexp_match(t, '(?:in|write|about|around|exactly|just)?\s*' || n || '\s*(?:short\s+|clear\s+|simple\s+)?sentences?'); m := case when m is null then null else array[m[1], m[1]] end; end if;
    if m is not null then
      lo := coalesce(array_position(num, m[1]), m[1]::int) * 8;
      hi := coalesce(array_position(num, m[2]), m[2]::int) * 30;
    else
      -- "about 200 words": 30% either side
      m := regexp_match(t, '(?:about|around|roughly|approximately)\s*(\d{1,4})\s*words?');
      if m is not null then lo := round(m[1]::int * 0.7); hi := round(m[1]::int * 1.3); end if;
    end if;
  end if;
  if lo is null then
    lo := coalesce(_min, 20); hi := coalesce(_max, 800);
    -- A stored range wider than 20x (e.g. 20 to 3000) says nothing; cap it.
    if hi > 1500 or hi > lo * 20 then hi := least(hi, greatest(lo * 6, 300)); end if;
  end if;
  lo := greatest(5, lo);
  return jsonb_build_object('min', lo, 'max', greatest(hi, lo + 10));
end $f$;
grant execute on function public.task_word_range(text, text, integer, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rubric_task_view(_task_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'prompt_text', c.prompt_text,
    'criteria', c.criteria,
    -- 255: the length the task text itself states (sentences or words) wins over the checker's stored range.
    'min_words', (public.task_word_range(t.title, t.description, c.min_words, c.max_words) ->> 'min')::int,
    'max_words', (public.task_word_range(t.title, t.description, c.min_words, c.max_words) ->> 'max')::int,
    'pass_threshold', c.pass_threshold,
    'scratch_language', c.scratch_language,
    'completed', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'passed'),
    'pending_review', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'needs_review'),
    'attempts', (
      select count(*) from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid())
  )
  from public.tasks t
  join public.task_rubric_config c on c.id = t.rubric_config_id
  where t.id = _task_id
    and (t.student_id = auth.uid()
         or exists (select 1 from public.task_assignments a
                     where a.task_id = t.id and a.student_id = auth.uid()));
$function$;

do $$
begin
  if public.task_word_range('x', 'In 3-4 sentences, explain why teamwork matters.', 100, 200) <> '{"min": 24, "max": 120}'::jsonb
     or public.task_word_range('x', 'Write 150 to 300 words.', 20, 3000) <> '{"min": 150, "max": 300}'::jsonb
     or public.task_word_range('x', 'Explain teamwork.', 20, 3000) <> '{"min": 20, "max": 300}'::jsonb
     or public.task_word_range('x', 'Explain teamwork.', 100, 250) <> '{"min": 100, "max": 250}'::jsonb
     or public.task_word_range('x', 'Describe it in five sentences.', 100, 250) <> '{"min": 40, "max": 150}'::jsonb then
    raise exception '255 self-check: task_word_range %', public.task_word_range('x', 'In 3-4 sentences, explain why teamwork matters.', 100, 200);
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
