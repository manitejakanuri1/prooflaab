-- 116 rollback: retire the interview sources added by 116.
begin;

update public.source_registry
   set retired_at = now()
 where domain in (
   'github.com/yangshun/tech-interview-handbook',
   'github.com/donnemartin/system-design-primer',
   'github.com/kdn251/interviews'
 );

do $$
begin
  if exists (select 1 from public.source_registry where domain in (
    'github.com/yangshun/tech-interview-handbook',
    'github.com/donnemartin/system-design-primer',
    'github.com/kdn251/interviews'
  ) and retired_at is null) then
    raise exception '116 rollback self-check: sources were not retired';
  end if;
end $$;

commit;
