-- Undo the 12 Nov 2026 AI chapter load (TEST): remove the chapters credited "Written for ProofLab" and the aws course.
begin;
delete from public.course_reads r using public.course_chapters c
 where r.course_slug = c.course_slug and r.position = c.position and c.credit = 'Written for ProofLab';
delete from public.course_chapters where credit = 'Written for ProofLab';
delete from public.course_tracks where course_slug = 'aws';
delete from public.courses where slug = 'aws';
update public.courses s set chapters = (select count(*) from public.course_chapters c where c.course_slug = s.slug);
commit;
