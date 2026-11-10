-- READ ONLY. Proves the QA Demo college holds exactly the 12 demo students and nobody else, before a week move.
select 'SCOPE: college=' || c.name || ' students=' || count(p.id)
       || ' not_demo=' || count(p.id) filter (where not public.is_demo_student(p.id))
       || ' emails_outside_demo_domain=' || count(p.id) filter (where u.email not like '%@qa-demo.prooflab.invalid')
       || case when count(p.id) = 12 and count(p.id) filter (where not public.is_demo_student(p.id)) = 0 then ' OK' else ' STOP' end
  from public.colleges c
  left join public.student_profiles p on p.college_id = c.id
  left join auth.users u on u.id = p.user_id
 where c.email = 'college@qa-demo.prooflab.invalid' and c.name = 'ProofLab QA Demo'
 group by c.name;
