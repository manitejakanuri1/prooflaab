-- 18 Sep 2026, two owner requests.
--  1. Squads form at every import, server side. The import function calls
--     form_squads() itself, so it needs EXECUTE (stage23 revoked it from
--     PUBLIC, which also took it from service_role).
--  2. Admin > Platform > Content library: see every crawled or submitted page,
--     read it, and hide a bad one so it never becomes a Lot again.
begin;

grant execute on function public.form_squads(uuid, uuid) to service_role;

-- Hidden pages stay (tasks and Lot templates point at them) but are never
-- handed out as a new Lot.
alter table public.source_content add column if not exists hidden_at timestamptz;

-- next_lot_source from stage75, unchanged except: hidden pages are skipped.
create or replace function public.next_lot_source(_student_id uuid)
returns uuid
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    select distinct k.source_content_id
      from public.tasks k
     where k.student_id = _student_id and k.source_content_id is not null
  ),
  my_college as (
    select college_id from public.student_profiles where id = _student_id
  ),
  fresh as (
    select sc.id
      from public.source_content sc
     where sc.id not in (select source_content_id from mine)
       and sc.hidden_at is null
     order by
       (sc.submitted_by_college_id is not null
          and sc.submitted_by_college_id = (select college_id from my_college)) desc,
       (sc.submitted_by_college_id is not null) desc,
       sc.fetched_at asc
     limit 1
  ),
  reuse as (
    select sc.id
      from public.source_content sc
      left join public.tasks k
        on k.source_content_id = sc.id and k.student_id = _student_id
     where sc.hidden_at is null
     group by sc.id
     order by max(k.lot_date) asc nulls first
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$;

-- The library: every page, where it came from, and how much it has been used.
create or replace function public.admin_content_library()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sc.id, 'url', sc.url, 'title', sc.title,
               'site', coalesce(r.name, r.domain), 'domain', r.domain,
               'fetch_method', sc.fetch_method, 'fetched_at', sc.fetched_at,
               'chars', length(coalesce(sc.markdown, '')),
               'college', c.name,
               'lot_written', exists (select 1 from public.lot_templates t where t.source_content_id = sc.id),
               'times_given', (select count(*) from public.tasks k where k.source_content_id = sc.id),
               'hidden', sc.hidden_at is not null)
             order by sc.hidden_at nulls first, sc.fetched_at desc)
        from public.source_content sc
        left join public.source_registry r on r.id = sc.source_id
        left join public.colleges c on c.id = sc.submitted_by_college_id), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('site', coalesce(name, domain), 'domain', domain,
                                          'seeds', cardinality(seed_urls), 'rights', rights_flag,
                                          'retired', retired_at is not null) order by domain)
        from public.source_registry), '[]'::jsonb),
    'newest_fetch', (select max(fetched_at) from public.source_content)
  );
end;
$$;

create or replace function public.admin_content_page(_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return (select jsonb_build_object('title', title, 'url', url, 'markdown', markdown)
            from public.source_content where id = _id);
end;
$$;

create or replace function public.admin_hide_content(_id uuid, _hidden boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.source_content
     set hidden_at = case when _hidden then coalesce(hidden_at, now()) else null end
   where id = _id;
end;
$$;

revoke all on function public.admin_content_library()          from public, anon;
revoke all on function public.admin_content_page(uuid)         from public, anon;
revoke all on function public.admin_hide_content(uuid, boolean) from public, anon;
grant execute on function public.admin_content_library()          to authenticated, service_role;
grant execute on function public.admin_content_page(uuid)         to authenticated, service_role;
grant execute on function public.admin_hide_content(uuid, boolean) to authenticated, service_role;
grant execute on function public.next_lot_source(uuid)            to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.form_squads(uuid, uuid)', 'EXECUTE') then
    raise exception 'service_role still cannot form squads';
  end if;
  if public.next_lot_source((select id from public.student_profiles limit 1)) is null
     and exists (select 1 from public.student_profiles)
     and exists (select 1 from public.source_content where hidden_at is null) then
    raise exception 'next_lot_source stopped finding content';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
