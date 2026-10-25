-- 143: two students can swap squads in the first 7 days of a season (owner decision 24 Oct 2026).
--
-- Ravi (Squad A) and Priya (Squad B), same section:
--   1. Every squad has a secret code (squad_codes), seen only by its members (and the admin).
--   2. Ravi enters Squad B's code (Priya gave it to him) and asks to swap with Priya.
--   3. Priya enters Squad A's code (Ravi gave it to her) and accepts.
--   4. Both move at the same moment; both squads stay the same size.
--   5. Each student's own points move with them: Ravi's points for A now count for B, Priya's for A.
--      Squad-level bonuses stay with the squad.
-- Rules: first 7 days of the season (India time) only, same college + season + section,
-- a wrong or missing code changes nothing, one swap per student per season,
-- an unanswered request lapses when the 7 days end, locked or archived squads cannot swap.
-- The college sees its own swaps; the admin sees every college, every code and every request.
begin;

create table if not exists public.squad_codes (
  squad_id   uuid primary key references public.squads(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.squad_swaps (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.seasons(id) on delete cascade,
  college_id   uuid references public.colleges(id) on delete cascade,
  cohort       text,
  from_student uuid not null references public.student_profiles(id) on delete cascade,
  from_squad   uuid not null references public.squads(id) on delete cascade,
  to_student   uuid not null references public.student_profiles(id) on delete cascade,
  to_squad     uuid not null references public.squads(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','done','declined','cancelled')),
  expires_at   timestamptz not null,
  from_points  integer,
  to_points    integer,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists squad_swaps_season on public.squad_swaps (season_id, status);
create index if not exists squad_swaps_college on public.squad_swaps (college_id, created_at desc);

alter table public.squad_codes enable row level security;
alter table public.squad_swaps enable row level security;
revoke all on public.squad_codes, public.squad_swaps from public, anon, authenticated;

-- A squad's code, made the first time anyone needs it. 31 letters/digits (no 0/O/1/I/L), 6 long.
create or replace function public.squad_code_for(_squad_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c text;
begin
  select code into c from public.squad_codes where squad_id = _squad_id;
  while c is null loop
    c := 'SQ-' || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
                     from generate_series(1, 6));
    begin
      insert into public.squad_codes (squad_id, code) values (_squad_id, c);
    exception when unique_violation then
      select code into c from public.squad_codes where squad_id = _squad_id;  -- raced, or code taken: retry
    end;
  end loop;
  return c;
end $fn$;

-- When swapping closes for a squad's season: midnight India time after day 7. Null = no open season.
create or replace function public.squad_swap_closes(_squad_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $fn$
  select ((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata')
    from public.squads q join public.seasons s on s.id = q.season_id
   where q.id = _squad_id and s.is_current and s.status = 'active' and q.archived_at is null;
$fn$;

-- The caller's current membership.
create or replace function public.squad_swap_me()
returns public.squad_members language sql stable security definer set search_path = public, pg_temp as $fn$
  select * from public.squad_members
   where student_id = (select auth.uid()) and left_at is null
   order by joined_at desc limit 1;
$fn$;

create or replace function public.squad_swap_used(_student uuid, _season uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from public.squad_swaps
                  where season_id = _season and status = 'done' and _student in (from_student, to_student));
$fn$;

-- Student: everything the swap box needs.
create or replace function public.my_squad_swap()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me public.squad_members; q record; closes timestamptz;
begin
  me := public.squad_swap_me();
  if me.id is null then return jsonb_build_object('in_squad', false); end if;
  select * into q from public.squads where id = me.squad_id;
  closes := public.squad_swap_closes(q.id);
  return jsonb_build_object(
    'in_squad', true,
    'squad', q.name,
    'open', closes is not null and now() < closes,
    'closes_at', closes,
    'code', case when closes is not null and now() < closes then public.squad_code_for(q.id) end,
    'used', public.squad_swap_used(me.student_id, q.season_id),
    'outgoing', (select jsonb_build_object('id', w.id, 'student', p.full_name, 'squad', s.name, 'created_at', w.created_at)
                   from public.squad_swaps w
                   join public.student_profiles p on p.id = w.to_student
                   join public.squads s on s.id = w.to_squad
                  where w.from_student = me.student_id and w.status = 'pending' and w.expires_at > now()
                  order by w.created_at desc limit 1),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'student', p.full_name, 'squad', s.name,
                                                              'created_at', w.created_at) order by w.created_at)
                            from public.squad_swaps w
                            join public.student_profiles p on p.id = w.from_student
                            join public.squads s on s.id = w.from_squad
                           where w.to_student = me.student_id and w.status = 'pending' and w.expires_at > now()), '[]'::jsonb));
end $fn$;

-- Student: the squad behind a code, with its members to pick from. Every rule is checked here.
create or replace function public.squad_swap_lookup(_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me public.squad_members; mine record; other record; closes timestamptz;
begin
  me := public.squad_swap_me();
  if me.id is null then raise exception 'You are not in a squad yet.'; end if;
  select * into mine from public.squads where id = me.squad_id;
  closes := public.squad_swap_closes(mine.id);
  if closes is null or now() >= closes then
    raise exception 'Squad swaps are open only in the first 7 days of the season.'; end if;
  if public.squad_swap_used(me.student_id, mine.season_id) then
    raise exception 'You have already swapped once this season.'; end if;

  select q.* into other from public.squad_codes c join public.squads q on q.id = c.squad_id
   where c.code = upper(btrim(coalesce(_code, '')));
  if other.id is null then raise exception 'That code is not right. Ask your friend for their squad code again.'; end if;
  if other.id = mine.id then raise exception 'That is your own squad''s code.'; end if;
  if other.college_id is distinct from mine.college_id or other.season_id is distinct from mine.season_id
     or other.archived_at is not null then
    raise exception 'That code is not right. Ask your friend for their squad code again.'; end if;
  if other.cohort is distinct from mine.cohort then
    raise exception 'You can swap only with a squad in your own section (%).', coalesce(mine.cohort, 'none'); end if;
  if mine.is_locked or other.is_locked then
    raise exception 'Your college has locked one of these squads, so it cannot swap.'; end if;

  return jsonb_build_object('squad_id', other.id, 'squad', other.name, 'cohort', other.cohort,
    'members', coalesce((select jsonb_agg(jsonb_build_object('student_id', m.student_id, 'name', p.full_name,
                                          'used', public.squad_swap_used(m.student_id, other.season_id))
                                          order by p.full_name)
                           from public.squad_members m join public.student_profiles p on p.id = m.student_id
                          where m.squad_id = other.id and m.left_at is null), '[]'::jsonb));
end $fn$;

-- Student: ask one member of that squad to swap.
create or replace function public.request_squad_swap(_code text, _with_student uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me public.squad_members; mine record; info jsonb; theirs uuid; sid uuid;
begin
  info := public.squad_swap_lookup(_code);              -- raises on every rule
  me := public.squad_swap_me();
  select * into mine from public.squads where id = me.squad_id;
  theirs := (info->>'squad_id')::uuid;
  if not exists (select 1 from public.squad_members where squad_id = theirs and student_id = _with_student and left_at is null) then
    raise exception 'That student is not in %.', info->>'squad'; end if;
  if public.squad_swap_used(_with_student, mine.season_id) then
    raise exception 'That student has already swapped once this season.'; end if;
  if exists (select 1 from public.squad_swaps where from_student = me.student_id and status = 'pending' and expires_at > now()) then
    raise exception 'You already have a swap request waiting. Cancel it first.'; end if;

  insert into public.squad_swaps (season_id, college_id, cohort, from_student, from_squad, to_student, to_squad, expires_at)
  values (mine.season_id, mine.college_id, mine.cohort, me.student_id, mine.id, _with_student, theirs,
          public.squad_swap_closes(mine.id))
  returning id into sid;

  insert into public.notifications (user_id, audience, source, type, title, message, link)
  values (_with_student, 'student', 'system', 'squad_swap_request',
          (select full_name from public.student_profiles where id = me.student_id) || ' wants to swap squads with you',
          'Open your Squad page. To accept, enter the code of ' || mine.name || ' that your friend gives you.',
          '/student/dashboard?tab=squad');
  return jsonb_build_object('ok', true, 'id', sid);
end $fn$;

create or replace function public.cancel_squad_swap(_swap_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update public.squad_swaps set status = 'cancelled', decided_at = now()
   where id = _swap_id and from_student = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'No waiting request to cancel.'; end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- Student: accept (with the requester's squad code) or decline. Accepting does the swap.
create or replace function public.answer_squad_swap(_swap_id uuid, _accept boolean, _code text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare w public.squad_swaps; a public.squad_members; b public.squad_members; fq record; tq record;
        closes timestamptz; pa integer; pb integer;
begin
  select * into w from public.squad_swaps where id = _swap_id and to_student = (select auth.uid());
  if w.id is null or w.status <> 'pending' or w.expires_at <= now() then
    raise exception 'This request is no longer waiting.'; end if;

  if not _accept then
    update public.squad_swaps set status = 'declined', decided_at = now() where id = w.id;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  if upper(btrim(coalesce(_code, ''))) is distinct from (select code from public.squad_codes where squad_id = w.from_squad) then
    raise exception 'That code is not right. Ask your friend for their squad code again.'; end if;

  -- ponytail: one lock per season serialises swaps; per-student locks if swaps ever get busy.
  perform pg_advisory_xact_lock(hashtext('squad_swap:' || w.season_id));

  select * into a from public.squad_members where student_id = w.from_student and squad_id = w.from_squad and left_at is null for update;
  select * into b from public.squad_members where student_id = w.to_student and squad_id = w.to_squad and left_at is null for update;
  if a.id is null or b.id is null then
    update public.squad_swaps set status = 'cancelled', decided_at = now() where id = w.id;
    raise exception 'One of you has already moved to another squad, so this swap was cancelled.'; end if;
  if public.squad_swap_used(w.from_student, w.season_id) or public.squad_swap_used(w.to_student, w.season_id) then
    raise exception 'One of you has already swapped once this season.'; end if;
  closes := public.squad_swap_closes(w.from_squad);
  if closes is null or now() >= closes then
    raise exception 'Squad swaps are open only in the first 7 days of the season.'; end if;
  select * into fq from public.squads where id = w.from_squad;
  select * into tq from public.squads where id = w.to_squad;
  if fq.is_locked or tq.is_locked then
    raise exception 'Your college has locked one of these squads, so it cannot swap.'; end if;

  -- 1. memberships
  update public.squad_members set left_at = now() where id in (a.id, b.id);
  insert into public.squad_members (squad_id, student_id, membership_type, assigned_by)
  values (w.to_squad, w.from_student, a.membership_type, (select auth.uid())),
         (w.from_squad, w.to_student, b.membership_type, (select auth.uid()));

  -- 2. each student's own points move with them (week by week; squad bonuses stay put)
  select coalesce(sum(points), 0) into pa from public.student_weekly_scores
   where season_id = w.season_id and student_id = w.from_student and squad_id = w.from_squad;
  select coalesce(sum(points), 0) into pb from public.student_weekly_scores
   where season_id = w.season_id and student_id = w.to_student and squad_id = w.to_squad;

  update public.squad_weekly_scores sw set points = sw.points + d.delta
    from (select week, squad_id, sum(delta) as delta from (
            select week, w.from_squad as squad_id, -points as delta from public.student_weekly_scores
             where season_id = w.season_id and student_id = w.from_student and squad_id = w.from_squad
            union all
            select week, w.to_squad, points from public.student_weekly_scores
             where season_id = w.season_id and student_id = w.from_student and squad_id = w.from_squad
            union all
            select week, w.to_squad, -points from public.student_weekly_scores
             where season_id = w.season_id and student_id = w.to_student and squad_id = w.to_squad
            union all
            select week, w.from_squad, points from public.student_weekly_scores
             where season_id = w.season_id and student_id = w.to_student and squad_id = w.to_squad) x
          group by week, squad_id) d
   where sw.season_id = w.season_id and sw.week = d.week and sw.squad_id = d.squad_id;

  update public.student_weekly_scores set squad_id = w.to_squad
   where season_id = w.season_id and student_id = w.from_student and squad_id = w.from_squad;
  update public.student_weekly_scores set squad_id = w.from_squad
   where season_id = w.season_id and student_id = w.to_student and squad_id = w.to_squad;

  update public.squads set points = points + case id when w.from_squad then pb - pa else pa - pb end,
                           updated_at = now()
   where id in (w.from_squad, w.to_squad);

  -- weekly ranks for every week already scored
  with r as (
    select squad_id, week, rank() over (partition by week order by points desc, squad_id) as pos
      from public.squad_weekly_scores where season_id = w.season_id)
  update public.squad_weekly_scores sw set rank = r.pos
    from r where sw.season_id = w.season_id and sw.squad_id = r.squad_id and sw.week = r.week and sw.rank is distinct from r.pos;

  -- 3. record it; any other waiting request for either student lapses
  update public.squad_swaps set status = 'done', decided_at = now(), from_points = pa, to_points = pb where id = w.id;
  update public.squad_swaps set status = 'cancelled', decided_at = now()
   where status = 'pending' and id <> w.id
     and (from_student in (w.from_student, w.to_student) or to_student in (w.from_student, w.to_student));

  perform public.write_audit('SQUAD_SWAP', 'squad_swaps', w.id,
    jsonb_build_object(w.from_student::text, w.from_squad, w.to_student::text, w.to_squad),
    jsonb_build_object(w.from_student::text, w.to_squad, w.to_student::text, w.from_squad,
                       'points_moved', jsonb_build_object(w.from_student::text, pa, w.to_student::text, pb)),
    w.college_id);

  return jsonb_build_object('ok', true, 'status', 'done', 'squad', fq.name);
end $fn$;

-- College (its own swaps) and admin (any college, or all). Students get nothing.
create or replace function public.squad_swaps_list(_college_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare cid uuid;
begin
  if public.is_admin() then cid := _college_id;
  else
    cid := public.my_college_id();
    if cid is null then raise exception 'only a college or an admin can see squad swaps'; end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', w.id, 'college', c.name, 'cohort', w.cohort,
             'status', case when w.status = 'pending' and w.expires_at <= now() then 'expired' else w.status end,
             'from_student', pa.full_name, 'from_squad', fa.name, 'from_points', w.from_points,
             'to_student', pb.full_name, 'to_squad', fb.name, 'to_points', w.to_points,
             'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
      from public.squad_swaps w
      left join public.colleges c on c.id = w.college_id
      join public.student_profiles pa on pa.id = w.from_student
      join public.student_profiles pb on pb.id = w.to_student
      join public.squads fa on fa.id = w.from_squad
      join public.squads fb on fb.id = w.to_squad
     where (cid is null or w.college_id = cid)
       and (public.is_admin() or w.status = 'done')), '[]'::jsonb);
end $fn$;

-- Admin: colleges with squads (no id), or one college's current squads with members and codes.
create or replace function public.admin_squads(_college_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if _college_id is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('college_id', c.id, 'college', c.name, 'season_starts', s.starts_on,
               'squads', (select count(*) from public.squads q where q.season_id = s.id and q.archived_at is null),
               'swaps', (select count(*) from public.squad_swaps w where w.season_id = s.id and w.status = 'done'))
               order by c.name)
        from public.seasons s join public.colleges c on c.id = s.college_id
       where s.is_current), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'name', q.name, 'cohort', q.cohort, 'points', q.points, 'rank', q.rank,
             'max_members', q.max_members, 'is_locked', q.is_locked, 'code', public.squad_code_for(q.id),
             'swap_closes', public.squad_swap_closes(q.id),
             'members', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'contribution', m.contribution,
                                                                      'joined_at', m.joined_at) order by p.full_name)
                                    from public.squad_members m join public.student_profiles p on p.id = m.student_id
                                   where m.squad_id = q.id and m.left_at is null), '[]'::jsonb))
           order by q.cohort nulls last, q.points desc, q.name)
      from public.squads q join public.seasons s on s.id = q.season_id
     where q.college_id = _college_id and s.is_current and q.archived_at is null), '[]'::jsonb);
end $fn$;

revoke all on function public.squad_code_for(uuid), public.squad_swap_closes(uuid), public.squad_swap_me(),
  public.squad_swap_used(uuid, uuid), public.my_squad_swap(), public.squad_swap_lookup(text),
  public.request_squad_swap(text, uuid), public.cancel_squad_swap(uuid), public.answer_squad_swap(uuid, boolean, text),
  public.squad_swaps_list(uuid), public.admin_squads(uuid) from public, anon, authenticated;
grant execute on function public.my_squad_swap(), public.squad_swap_lookup(text), public.request_squad_swap(text, uuid),
  public.cancel_squad_swap(uuid), public.answer_squad_swap(uuid, boolean, text),
  public.squad_swaps_list(uuid), public.admin_squads(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.squad_code_for(uuid)', 'execute') then
    raise exception '143 self-check: students can read any squad code';
  end if;
  if has_table_privilege('authenticated', 'public.squad_codes', 'select')
     or has_table_privilege('authenticated', 'public.squad_swaps', 'select') then
    raise exception '143 self-check: swap tables are readable directly';
  end if;
  if not has_function_privilege('authenticated', 'public.answer_squad_swap(uuid,boolean,text)', 'execute') then
    raise exception '143 self-check: students cannot answer a swap';
  end if;
  -- No caller inside the migration: no squad.
  if (public.my_squad_swap()->>'in_squad')::boolean then
    raise exception '143 self-check: my_squad_swap found a squad without a caller';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
