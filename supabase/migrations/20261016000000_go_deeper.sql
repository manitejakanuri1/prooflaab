-- "Go deeper" card on every lesson step (owner's request, 19 Sep 2026):
-- a worked example, common mistakes and a small "try this", written once by
-- AI and kept forever. {example, code, mistakes[], try_this}
begin;

alter table public.level_content add column if not exists go_deeper jsonb;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'level_content' and column_name = 'go_deeper') then
    raise exception 'level_content.go_deeper missing';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
