-- Rollback for 235: removes the 40 ProofLab pitch Lots that no student has been given yet (given ones stay, retired).
begin;
update public.lot_candidates set status = 'retired'
 where lot_template_id in (select id from public.lot_templates where source_jd = 'Written by ProofLab (pitch practice)');
delete from public.lot_templates t where t.source_jd = 'Written by ProofLab (pitch practice)'
   and not exists (select 1 from public.tasks k where k.source_content_id = t.source_content_id);
commit;
