-- 147: the question bank - a crawled page cut into small, tagged questions, reviewed by an admin before use.
--
-- WHY. A Lot is written from one whole crawled page. The 13 Sep plan was to cut each page into several
-- small questions, each tagged with a skill, so a later change can give a student a question that fits their
-- weak skill. This is STEP ONE only: store the questions and let an admin review them.
-- Nothing here changes how Lots are picked: next_lot_pick, create_lot_for and lot_templates are not touched.
--
-- WHAT.
--   question_bank           one row per question. status 'draft' (new) -> 'approved' or 'hidden' by an admin.
--                           skill is one of the fixed skill_vocab skills, set by a trigger from tag_skills()
--                           (migration 88): a keyword lookup, never a model's opinion. A question that
--                           matches no vocabulary skill keeps skill = null. A question appears once per page.
--   question_bank_attempts  one row per page the splitter has tried, so a page is not sent to the AI twice.
--   question_bank_pending() pages not yet tried (service role only: the question-decompose function uses it).
--   question_bank_add()     stores a page's questions in one call, skipping bad or duplicate rows.
--   admin_question_bank()   admin list (drafts first) with counts; admin_set_question_status() approves or hides.
-- No student, company, college or anonymous caller can read or write any of it.
begin;

create table if not exists public.question_bank (
  id                uuid primary key default gen_random_uuid(),
  source_content_id uuid not null references public.source_content(id) on delete cascade,
  question          text not null check (length(btrim(question)) between 15 and 600),
  answer_notes      text check (answer_notes is null or length(answer_notes) <= 1200),
  topic             text check (topic is null or length(topic) <= 80),
  skill             text references public.skill_vocab(skill) on update cascade on delete set null,
  skills            text[] not null default '{}',
  difficulty        text check (difficulty in ('easy', 'medium', 'hard')),
  kind              text not null check (kind in ('coding', 'written', 'mcq')),
  status            text not null default 'draft' check (status in ('draft', 'approved', 'hidden')),
  provenance        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid
);
-- The same question on the same page is stored once, however it is spaced or capitalised.
create unique index if not exists question_bank_one_per_page
  on public.question_bank (source_content_id, md5(lower(btrim(question))));
create index if not exists question_bank_status on public.question_bank (status, created_at desc);
create index if not exists question_bank_skill on public.question_bank (skill) where status = 'approved';

create table if not exists public.question_bank_attempts (
  source_content_id uuid primary key references public.source_content(id) on delete cascade,
  attempted_at      timestamptz not null default now(),
  stored            integer not null default 0,
  skipped           integer not null default 0
);

alter table public.question_bank enable row level security;
alter table public.question_bank_attempts enable row level security;
revoke all on public.question_bank, public.question_bank_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.question_bank, public.question_bank_attempts to service_role;

-- The skill is decided by the fixed vocabulary, never supplied by the caller.
create or replace function public.question_bank_tag()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare tags text[];
begin
  tags := public.tag_skills(coalesce(new.question, '') || ' ' || coalesce(new.answer_notes, '') || ' ' || coalesce(new.topic, ''));
  new.skills := tags;
  new.skill := tags[1];
  return new;
end $fn$;

drop trigger if exists question_bank_tag on public.question_bank;
create trigger question_bank_tag before insert on public.question_bank
  for each row execute function public.question_bank_tag();

-- Pages the splitter has not tried yet (visible pages with enough text), newest first.
create or replace function public.question_bank_pending(_limit integer default 3)
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select sc.id
    from public.source_content sc
   where sc.hidden_at is null
     and length(coalesce(sc.markdown, '')) >= 300
     and not exists (select 1 from public.question_bank_attempts a where a.source_content_id = sc.id)
   order by sc.fetched_at desc
   limit greatest(1, least(coalesce(_limit, 3), 10));
$fn$;

-- Stores one page's questions. Rows that break a rule or repeat a question are skipped, never an error:
-- the caller has already paid for the AI call and should keep what is good.
create or replace function public.question_bank_add(_source_content_id uuid, _items jsonb, _provenance jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare it jsonb; stored integer := 0; skipped integer := 0; n integer;
begin
  if _source_content_id is null or not exists (select 1 from public.source_content where id = _source_content_id) then
    raise exception 'unknown source_content_id';
  end if;
  if jsonb_typeof(coalesce(_items, 'null'::jsonb)) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;
  for it in select * from jsonb_array_elements(_items) loop
    begin
      insert into public.question_bank (source_content_id, question, answer_notes, topic, difficulty, kind, provenance)
      values (_source_content_id, btrim(it ->> 'question'), nullif(btrim(coalesce(it ->> 'answer_notes', '')), ''),
              nullif(btrim(coalesce(it ->> 'topic', '')), ''), it ->> 'difficulty', it ->> 'kind',
              coalesce(_provenance, '{}'::jsonb))
      on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then stored := stored + 1; else skipped := skipped + 1; end if;
    exception when check_violation or not_null_violation then
      skipped := skipped + 1;
    end;
  end loop;
  insert into public.question_bank_attempts (source_content_id, stored, skipped)
  values (_source_content_id, stored, skipped)
  on conflict (source_content_id) do update
    set attempted_at = now(), stored = excluded.stored, skipped = excluded.skipped;
  return jsonb_build_object('stored', stored, 'skipped', skipped);
end $fn$;

-- Admin: the bank, newest first, with a count per status. _after pages by created_at.
create or replace function public.admin_question_bank(_status text default 'draft', _limit integer default 50, _after timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'draft',    (select count(*) from public.question_bank where status = 'draft'),
      'approved', (select count(*) from public.question_bank where status = 'approved'),
      'hidden',   (select count(*) from public.question_bank where status = 'hidden'),
      'untagged', (select count(*) from public.question_bank where skill is null)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'question', q.question, 'answer_notes', q.answer_notes, 'topic', q.topic,
               'skill', q.skill, 'difficulty', q.difficulty, 'kind', q.kind, 'status', q.status,
               'created_at', q.created_at, 'page_title', sc.title, 'page_url', sc.url)
             order by q.created_at desc)
        from (select * from public.question_bank
               where (_status is null or status = _status)
                 and (_after is null or created_at < _after)
               order by created_at desc
               limit greatest(1, least(coalesce(_limit, 50), 200))) q
        join public.source_content sc on sc.id = q.source_content_id), '[]'::jsonb));
end $fn$;

create or replace function public.admin_set_question_status(_id uuid, _status text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if _status not in ('draft', 'approved', 'hidden') then raise exception 'status must be draft, approved or hidden'; end if;
  update public.question_bank
     set status = _status,
         reviewed_at = case when _status = 'draft' then null else now() end,
         reviewed_by = case when _status = 'draft' then null else (select auth.uid()) end
   where id = _id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'question not found'; end if;
end $fn$;

revoke all on function public.question_bank_tag(), public.question_bank_pending(integer),
  public.question_bank_add(uuid, jsonb, jsonb), public.admin_question_bank(text, integer, timestamptz),
  public.admin_set_question_status(uuid, text) from public, anon, authenticated;
grant execute on function public.question_bank_pending(integer), public.question_bank_add(uuid, jsonb, jsonb) to service_role;
grant execute on function public.admin_question_bank(text, integer, timestamptz), public.admin_set_question_status(uuid, text)
  to authenticated, service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.question_bank', 'select')
     or has_table_privilege('anon', 'public.question_bank', 'select')
     or has_table_privilege('authenticated', 'public.question_bank_attempts', 'select') then
    raise exception '147 self-check: the question bank is readable by students or anonymous callers';
  end if;
  if has_function_privilege('authenticated', 'public.question_bank_add(uuid,jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.question_bank_pending(integer)', 'execute') then
    raise exception '147 self-check: signed-in users can write or scan the question bank';
  end if;
  if has_function_privilege('anon', 'public.admin_question_bank(text,integer,timestamptz)', 'execute') then
    raise exception '147 self-check: anonymous callers can reach the admin list';
  end if;
  if not ('SQL' = any (public.tag_skills('Write a SQL query with a JOIN'))) then
    raise exception '147 self-check: skill_vocab no longer tags SQL questions';
  end if;
  begin
    perform public.admin_question_bank();
    raise exception '147 self-check: admin_question_bank answered with no admin caller';
  exception when raise_exception then
    if sqlerrm <> 'admins only' then raise; end if;
  end;
end $$;

commit;
notify pgrst, 'reload schema';
