-- "Read more" cards inside a lesson step (owner's request, 19 Sep 2026): real
-- sections from open-licence GitHub repos (MIT, Apache, BSD, CC-BY, CC-BY-SA,
-- CC0), shown in the app with a plain-text credit - students never leave
-- ProofLab. [{heading, text, source, licence}], matched by keyword, no AI.
begin;

alter table public.level_content add column if not exists read_more jsonb;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'level_content' and column_name = 'read_more') then
    raise exception 'level_content.read_more missing';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
