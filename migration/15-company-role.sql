-- Startup and Recruiter become one role on screen: Company (owner's decision, 17 Sep 2026).
--
-- The database keeps app_role 'startup' as the company role. Recruiter features
-- never checked the login role - every recruiter function keys on the
-- recruiters table (my_recruiter_id(), is_verified_recruiter()) - so a company
-- gets everything a recruiter had simply by also having a recruiters row.
-- Nothing is dropped: startups, startup_profiles, recruiters, shortlists, views
-- and sponsored Lots all stay exactly where they are.
begin;

-- 1. Existing recruiter logins become company logins, with a startup record.
insert into public.startups (user_id, name, email, status, verification_status)
select r.id, r.company, coalesce(r.work_email, u.email::text),
       case when r.verified then 'active' else 'pending' end,
       case when r.verified then 'approved' else 'pending' end
  from public.recruiters r
  join auth.users u on u.id = r.id
 where not exists (select 1 from public.startups s where s.user_id = r.id);

insert into public.startup_profiles (user_id, startup_name, website)
select r.id, r.company, r.website
  from public.recruiters r
 where not exists (select 1 from public.startup_profiles p where p.user_id = r.id);

update public.user_roles
   set role = 'startup'::public.app_role, has_completed_wizard = true
 where role = 'recruiter'::public.app_role;

-- 2. Existing startups get the recruiter half.
insert into public.recruiters (id, company, contact_name, work_email, verified, verified_at)
select s.user_id, s.name, s.name, s.email,
       s.verification_status = 'approved',
       case when s.verification_status = 'approved' then now() end
  from public.startups s
 where not exists (select 1 from public.recruiters r where r.id = s.user_id);

-- 3. Keep the two halves in step from now on. A new company signs up through
-- the startups row; approving it (Admin > People > Companies) flips
-- verification_status. Both reach the recruiter half through this trigger.
create or replace function public.company_sync_recruiter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.recruiters (id, company, contact_name, work_email, verified, verified_at)
  values (new.user_id, new.name, new.name, new.email,
          new.verification_status = 'approved',
          case when new.verification_status = 'approved' then now() end)
  on conflict (id) do update
     set company     = excluded.company,
         verified    = excluded.verified,
         verified_at = case when excluded.verified and not recruiters.verified then now()
                            else recruiters.verified_at end
   where recruiters.company is distinct from excluded.company
      or recruiters.verified is distinct from excluded.verified;
  return new;
end $$;

drop trigger if exists company_sync_recruiter on public.startups;
create trigger company_sync_recruiter
  after insert or update of name, verification_status on public.startups
  for each row execute function public.company_sync_recruiter();

-- The old recruiter approval (admin_verify_recruiter) still works: it flows
-- back to the startup half. Only fires when the value actually differs, so the
-- two triggers cannot loop.
create or replace function public.company_sync_startup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.startups
     set verification_status = case when new.verified then 'approved' else 'pending' end
   where user_id = new.id
     and (verification_status = 'approved') is distinct from new.verified;
  return new;
end $$;

drop trigger if exists company_sync_startup on public.recruiters;
create trigger company_sync_startup
  after update of verified on public.recruiters
  for each row execute function public.company_sync_startup();

revoke all on function public.company_sync_recruiter() from public, anon, authenticated;
revoke all on function public.company_sync_startup()   from public, anon, authenticated;

do $$
begin
  if exists (select 1 from public.user_roles where role = 'recruiter'::public.app_role) then
    raise exception 'a recruiter login was not converted to company';
  end if;
  if exists (select 1 from public.user_roles ur
              where ur.role = 'startup'::public.app_role
                and (not exists (select 1 from public.startups s where s.user_id = ur.user_id)
                  or not exists (select 1 from public.recruiters r where r.id = ur.user_id))) then
    raise exception 'a company login is missing its startup or recruiter half';
  end if;
  if exists (select 1 from public.startups s join public.recruiters r on r.id = s.user_id
              where (s.verification_status = 'approved') <> r.verified) then
    raise exception 'startup approval and recruiter verification disagree';
  end if;
end $$;

commit;
