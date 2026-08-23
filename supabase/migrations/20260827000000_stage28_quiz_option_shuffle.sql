-- ============================================================================
-- Stage 28 — the checkpoint quiz stops giving itself away.
--
-- The prompt asks the model to vary which option is correct. It does not.
-- Measured across the forty questions written so far: 9 answers at A, 26 at B,
-- 4 at C, 1 at D. A checkpoint serves five questions and passes at three, so a
-- student clicking the second option every single time passes without reading
-- anything — on a platform whose entire claim is that the work is proved.
--
-- The generator now shuffles each question's options on the way into storage
-- (supabase/functions/_shared/levels.ts), which keeps grading comparing against
-- one stored index. This moves the ones already written.
-- ============================================================================

create or replace function public.reshuffle_quiz_options()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  row_     record;
  q        jsonb;
  new_q    jsonb;
  opts     jsonb;
  answer   text;
  shuffled jsonb;
  touched  integer := 0;
begin
  for row_ in
    select level_id, quiz from public.level_content
     where jsonb_array_length(coalesce(quiz, '[]'::jsonb)) > 0
  loop
    new_q := '[]'::jsonb;

    for q in select * from jsonb_array_elements(row_.quiz) loop
      opts := q->'options';

      -- A malformed question is left exactly as it was rather than dropped.
      if jsonb_typeof(opts) <> 'array'
         or coalesce((q->>'correct_index')::int, -1) not between 0 and jsonb_array_length(opts) - 1 then
        new_q := new_q || jsonb_build_array(q);
        continue;
      end if;

      answer := opts->>((q->>'correct_index')::int);

      select jsonb_agg(value order by random()) into shuffled
        from jsonb_array_elements(opts);

      new_q := new_q || jsonb_build_array(
        q || jsonb_build_object(
          'options', shuffled,
          'correct_index', (
            select i - 1 from generate_series(1, jsonb_array_length(shuffled)) i
             where shuffled->>(i - 1) = answer limit 1)));
    end loop;

    update public.level_content set quiz = new_q where level_id = row_.level_id;
    touched := touched + 1;
  end loop;

  return jsonb_build_object('ok', true, 'topics_reshuffled', touched);
end $fn$;

revoke all on function public.reshuffle_quiz_options() from public, anon, authenticated;

-- One pass over what already exists. Running it again would only shuffle them
-- a second time, which is harmless.
select public.reshuffle_quiz_options();
