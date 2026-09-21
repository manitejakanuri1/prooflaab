-- 36: each AI call records the request id of the student action that caused it, so one id shows
-- the whole path (screen -> function -> AI call). Nullable: old rows and non-request calls stay empty.
begin;
alter table public.llm_usage add column if not exists request_id text;
create index if not exists llm_usage_request_id_idx on public.llm_usage (request_id) where request_id is not null;
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='llm_usage' and column_name='request_id') then
    raise exception 'llm_usage.request_id missing';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
