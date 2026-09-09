-- Wires lot-writer to source_content (the crawler's own output, and now
-- college/TPO submissions) as a second grounding source when no matching
-- job posting exists. Same table, two producers.

-- Pseudo source representing human-submitted (college/TPO) material, so it
-- flows through the exact same source_content grounding pipeline the
-- crawler feeds, rather than a second parallel table.
insert into public.source_registry (domain, name, seed_urls, path_scope, rights_flag, known_dynamic, rate_limit_per_min, max_depth, license_note)
select 'college-submitted', 'College / TPO submitted material', array[]::text[], array[]::text[], 'ORIGINAL_ONLY', false, 1, 1,
       'Not crawled. Fed by college_submit_source_content(), one row per submission.'
where not exists (select 1 from public.source_registry where domain = 'college-submitted');

-- Traceability: which college submitted a given source_content row. Null for
-- everything the crawler wrote.
alter table public.source_content
  add column if not exists submitted_by_college_id uuid references public.colleges(id);

-- 'manual' is a legitimately new fetch method (a human typed it in), not a
-- fit for the crawler's existing 'static'/'browser' pair.
alter table public.source_content drop constraint if exists source_content_fetch_method_check;
alter table public.source_content add constraint source_content_fetch_method_check
  check (fetch_method = any (array['static','browser','manual']));

-- A college submits real interview questions / reference material directly
-- (not a raw insert — this text ends up inside an AI prompt server-side, so
-- it is validated here, not trusted from the client). Length floor matches
-- the one lot-writer itself uses to reject an empty model answer, so a
-- one-line submission cannot pass through as if it were real material.
create or replace function public.college_submit_source_content(_title text, _content text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  _college_id uuid;
  _clean_title text;
  _clean_content text;
  _new_id uuid;
begin
  select id into _college_id from public.colleges where user_id = auth.uid();
  if _college_id is null then
    raise exception 'Only a signed-in college account may submit material';
  end if;

  _clean_title := trim(coalesce(_title, ''));
  _clean_content := trim(coalesce(_content, ''));

  if length(_clean_title) < 3 or length(_clean_title) > 200 then
    raise exception 'Title must be 3-200 characters';
  end if;
  if length(_clean_content) < 80 then
    raise exception 'Content must be at least 80 characters — this becomes real source material, not a label';
  end if;
  if length(_clean_content) > 5000 then
    raise exception 'Content must be under 5000 characters';
  end if;

  insert into public.source_content (
    source_id, url, canonical_url, title, markdown, content_hash, fetch_method,
    rights_flag, submitted_by_college_id
  )
  select
    sr.id,
    'college-submission:' || gen_random_uuid()::text,
    null,
    _clean_title,
    _clean_content,
    encode(sha256(_clean_content::bytea), 'hex'),
    'manual',
    'ORIGINAL_ONLY',
    _college_id
  from public.source_registry sr
  where sr.domain = 'college-submitted'
  returning id into _new_id;

  return _new_id;
end;
$function$;

revoke all on function public.college_submit_source_content(text, text) from public, anon;
grant execute on function public.college_submit_source_content(text, text) to authenticated;
