-- Read-only. How far does the owner mismatch reach, what are the active seasons, and who connects as prooflab_app?

-- A definer function runs as its owner. Listed: it writes to a table with row rules that its owner does not own.
-- write_policy yes = a write rule may let it through (the rule's condition still decides); no = the write is refused.
-- Found by searching function text, so writes built as dynamic SQL are not listed.
select 'WRITES: ' || t.relname || ' | ' || p.proname || ' | owner ' || pg_get_userbyid(p.proowner)
    || ' | write_policy ' || case when exists (
         select 1 from pg_policy o
          where o.polrelid = t.oid and o.polcmd in ('*', 'a', 'w', 'd')
            and (0 = any (o.polroles) or exists (select 1 from unnest(o.polroles) r where pg_has_role(p.proowner, r, 'MEMBER')))
       ) then 'yes' else 'no' end
  from pg_proc p
  join pg_class t on t.relkind = 'r' and t.relnamespace = 'public'::regnamespace and t.relrowsecurity
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and not pg_has_role(p.proowner, t.relowner, 'USAGE')
   and p.prosrc ~* ('(insert\s+into|update|delete\s+from|merge\s+into|truncate)\s+(only\s+)?(table\s+)?(public\.)?' || t.relname || '\M')
 order by t.relname, p.proname;

-- Counts only, no student names.
select 'SEASON: ' || c.name || ' | ' || s.name || ' | started ' || s.starts_on || ' | week ' || public.season_week(s.id)
    || ' | squads ' || (select count(*) from public.squads q where q.season_id = s.id and q.archived_at is null)
    || ' | students ' || (select count(*) from public.squad_members m join public.squads q on q.id = m.squad_id
                           where q.season_id = s.id and m.left_at is null)
    || ' | submissions ' || (select count(*) from public.task_submissions x
                              where x.created_at >= s.starts_on
                                and x.student_id in (select m.student_id from public.squad_members m join public.squads q on q.id = m.squad_id
                                                      where q.season_id = s.id and m.left_at is null))
  from public.seasons s join public.colleges c on c.id = s.college_id
 where s.status = 'active'
 order by c.name, s.name;

-- What the role can do, and who uses it right now. No connection details beyond role and program name.
select 'ROLE: ' || rolname || ' | login ' || rolcanlogin || ' | bypass_rules ' || rolbypassrls || ' | superuser ' || rolsuper
  from pg_roles where rolname in ('prooflab_app', 'postgres', 'authenticator', 'authenticated', 'anon', 'service_role')
 order by rolname;
select 'MEMBER: ' || pg_get_userbyid(member) || ' is in ' || pg_get_userbyid(roleid)
  from pg_auth_members
 where pg_get_userbyid(member) in ('prooflab_app', 'postgres', 'authenticator') or pg_get_userbyid(roleid) = 'prooflab_app'
 order by 1;
select 'CONNECTED: ' || coalesce(usename::text, '-') || ' | ' || coalesce(nullif(application_name, ''), 'no name') || ' | ' || count(*)
  from pg_stat_activity
 where datname = current_database()
 group by usename, application_name
 order by 1;
