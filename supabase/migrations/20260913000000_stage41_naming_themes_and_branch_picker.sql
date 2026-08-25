-- ============================================================================
-- Stage 41 — the other half of §27: "squad naming... should not be
-- hard-coded where avoidable." Same shape as stage 40's scoring weights:
-- a college_id = null row is the platform default (unchanged, 9 rows), a
-- college that wants "IT is Falcons, not Intellects" gets its own row and
-- only that branch changes for them.
-- ============================================================================

alter table public.squad_name_themes
  add column id uuid not null default gen_random_uuid(),
  add column college_id uuid references public.colleges(id) on delete cascade;

alter table public.squad_name_themes drop constraint squad_name_themes_pkey;
alter table public.squad_name_themes add constraint squad_name_themes_pkey primary key (id);

alter table public.squad_name_themes
  add constraint squad_name_themes_branch_college_key
  unique nulls not distinct (branch, college_id);

create index squad_name_themes_college_idx on public.squad_name_themes (college_id);

-- Scoped the same way stage 40 scoped squad_scoring_rules: a college's own
-- rows plus the platform defaults, not every college's customizations.
drop policy themes_read on public.squad_name_themes;
create policy themes_read on public.squad_name_themes for select to authenticated
  using (college_id is null or college_id = public.my_college_id());


create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  sid uuid; town text; created integer := 0; placed integer := 0;
  br record; sq uuid; theme text; n integer; full_squads integer; i integer;
  stu record; seat integer;
begin
  select id into sid from public.seasons
   where college_id = _college_id and is_current
   order by starts_on desc limit 1;
  if _season_id is not null then sid := _season_id; end if;
  if sid is null then raise exception 'no season is running for this college'; end if;

  town := public.squad_town(_college_id);

  -- Squads are formed per branch, because a squad is a group of people who sit
  -- near each other and can actually meet.
  for br in
    select coalesce(nullif(trim(p.branch), ''), 'GENERAL') as branch, count(*) as students
      from public.student_profiles p
     where p.college_id = _college_id
       and p.onboarding_status = 'completed'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
  loop
    full_squads := floor(br.students / 11.0);
    continue when full_squads < 1;   -- fewer than eleven: everybody stays in reserve

    -- This college's own theme for the branch wins; the platform default for
    -- that branch is next; the platform's wildcard theme is the last resort.
    select t.theme into theme
      from public.squad_name_themes t
     where t.branch = br.branch and (t.college_id = _college_id or t.college_id is null)
     order by t.college_id nulls last
     limit 1;
    if theme is null then
      select t.theme into theme
        from public.squad_name_themes t
       where t.branch = '*' and (t.college_id = _college_id or t.college_id is null)
       order by t.college_id nulls last
       limit 1;
    end if;

    for i in 1..full_squads loop
      -- The first squad of a branch carries the plain name; later ones are
      -- numbered, so "Surampalem Warriors Titans" and "… Titans II".
      insert into public.squads (name, college_id, season_id, max_members)
      values (town || ' Warriors ' || theme ||
              case when i > 1 then ' ' || repeat('I', i) else '' end,
              _college_id, sid, 11)
      returning id into sq;
      created := created + 1;

      seat := 0;
      for stu in
        select p.id from public.student_profiles p
         where p.college_id = _college_id
           and coalesce(nullif(trim(p.branch), ''), 'GENERAL') = br.branch
           and p.onboarding_status = 'completed'
           and not exists (select 1 from public.squad_members m
                            where m.student_id = p.id and m.left_at is null)
         order by p.roll_number nulls last, p.full_name
         limit 11
      loop
        insert into public.squad_members (squad_id, student_id, joined_at)
        values (sq, stu.id, now());
        seat := seat + 1;
        placed := placed + 1;
      end loop;
    end loop;
  end loop;

  perform public.write_audit('SQUADS_FORMED', 'squads', _college_id, null,
    jsonb_build_object('squads_created', created, 'students_placed', placed), _college_id);

  return jsonb_build_object(
    'ok', true, 'squads_created', created, 'students_placed', placed,
    'reserve', (select count(*) from public.student_profiles p
                 where p.college_id = _college_id
                   and p.onboarding_status = 'completed'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $fn$;


-- ── what a college sees and can change ──────────────────────────────────
create function public.tpo_naming_themes()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'branch', d.branch, 'default_theme', d.theme,
           'theme', coalesce(o.theme, d.theme),
           'customized', o.theme is not null)
         order by (d.branch = '*'), d.branch), '[]'::jsonb)
    from public.squad_name_themes d
    left join public.squad_name_themes o
      on o.branch = d.branch and o.college_id = public.my_college_id()
   where d.college_id is null;
$$;

grant execute on function public.tpo_naming_themes() to authenticated;

create function public.tpo_set_naming_theme(_branch text, _theme text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid uuid := public.my_college_id();
begin
  if cid is null then raise exception 'Only a college can set this.'; end if;
  if nullif(trim(coalesce(_theme, '')), '') is null then
    raise exception 'A theme needs a name.';
  end if;
  if not exists (select 1 from public.squad_name_themes where branch = _branch and college_id is null) then
    raise exception 'unknown branch %', _branch;
  end if;

  insert into public.squad_name_themes (branch, theme, college_id)
  values (_branch, trim(_theme), cid)
  on conflict (branch, college_id) do update set theme = excluded.theme;

  return jsonb_build_object('ok', true, 'branch', _branch, 'theme', trim(_theme));
end $$;

grant execute on function public.tpo_set_naming_theme(text, text) to authenticated;

create function public.tpo_reset_naming_theme(_branch text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid uuid := public.my_college_id();
begin
  if cid is null then raise exception 'Only a college can reset this.'; end if;
  delete from public.squad_name_themes where branch = _branch and college_id = cid;
  return jsonb_build_object('ok', true, 'branch', _branch);
end $$;

grant execute on function public.tpo_reset_naming_theme(text) to authenticated;
