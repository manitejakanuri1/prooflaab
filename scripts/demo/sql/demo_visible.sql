-- REAL data change for the 12 QA Demo students ONLY: switch on "Companies can see my profile" (is_public).
-- Real students are never touched: the college must be the ProofLab QA Demo and every student must be a demo student.
-- Real companies still never see them (173 + 217). Undo: same query with is_public = false.
select set_config('app.system_write', 'on', true);
do $$
declare cid uuid; n int;
begin
  select id into strict cid from public.colleges where email = 'college@qa-demo.prooflab.invalid' and name = 'ProofLab QA Demo';
  if exists (select 1 from public.student_profiles p where p.college_id = cid and not public.is_demo_student(p.id)) then
    raise exception 'A student in the QA Demo college is not a demo student. Nothing was changed.';
  end if;
  insert into public.student_portfolios (student_id, is_public)
  select p.id, true from public.student_profiles p where p.college_id = cid
  on conflict (student_id) do update set is_public = true, updated_at = now();
  select count(*) into n from public.student_portfolios f join public.student_profiles p on p.id = f.student_id
   where p.college_id = cid and f.is_public;
  if n <> 12 then raise exception 'Expected 12 visible demo students, got %. Nothing was changed.', n; end if;
end $$;
