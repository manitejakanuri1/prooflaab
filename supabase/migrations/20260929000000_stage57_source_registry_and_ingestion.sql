-- ============================================================================
-- Stage 57 — the ingestion side: where question material is allowed to come
-- from, and how it is stopped from arriving twice.
--
-- Master Specification v2, sections 04, 06, 07 and 17.03. Additive: nothing
-- existing reads these tables yet. This is the governed pipeline the Crawl4AI
-- worker will feed, built before the worker so the worker has rules to obey.
--
-- Three tables:
--   source_registry  every domain the crawler may touch, and on what terms
--   crawl_queue      work waiting for a worker, claimed with SKIP LOCKED
--   source_content   what was actually fetched, kept forever as provenance
--
-- The rights flags are the spec's own (section 06). Only APPROVED_SOURCE and
-- ORIGINAL_ONLY are ever handed to a worker; REVIEW_REQUIRED is stored but
-- never generated from, and BLOCKED_SOURCE is never fetched at all. Retiring a
-- source disables it without deleting the history that came from it.
--
-- Deduplication runs locally and costs nothing (section 17.03): exact content
-- hash first, then SimHash within 3 bits, then pg_trgm similarity. No
-- embeddings, no external API call, and all of it before a single token is
-- spent on AI enrichment.
--
-- The crawler is not the source of truth. It is an acquisition tool. The truth
-- is the validated question, which points back at a row in source_content.
-- ============================================================================

create extension if not exists pg_trgm;

create table if not exists public.source_registry (
  id           uuid primary key default gen_random_uuid(),
  domain       text not null unique,
  name         text,
  seed_urls    text[] not null default '{}',
  path_scope   text[] not null default '{}',
  rights_flag  text not null default 'REVIEW_REQUIRED'
                 check (rights_flag in ('APPROVED_SOURCE','REVIEW_REQUIRED','BLOCKED_SOURCE','ORIGINAL_ONLY')),
  known_dynamic boolean not null default false,
  rate_limit_per_min integer not null default 20 check (rate_limit_per_min between 1 and 600),
  max_depth    integer not null default 1 check (max_depth between 0 and 5),
  license_note text,
  retired_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.source_registry is
  'Every domain the crawler is allowed to touch, and on what terms. Nothing is crawled that is not listed here with rights_flag APPROVED_SOURCE or ORIGINAL_ONLY. Retiring a source disables it without deleting history.';
comment on column public.source_registry.rights_flag is
  'APPROVED_SOURCE: reuse understood, may generate. REVIEW_REQUIRED: store but never publish. BLOCKED_SOURCE: never fetch. ORIGINAL_ONLY: use as inspiration, generate original wording, keep provenance.';
comment on column public.source_registry.known_dynamic is
  'True skips the cheap static fetch and goes straight to a browser render. Section 17.02: browser rendering is orders of magnitude dearer, so this stays false unless a static fetch has actually failed.';

create table if not exists public.crawl_queue (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references public.source_registry(id) on delete cascade,
  url          text not null,
  depth        integer not null default 0,
  status       text not null default 'queued'
                 check (status in ('queued','fetching','done','failed','skipped')),
  attempts     integer not null default 0,
  last_error   text,
  claimed_at   timestamptz,
  claimed_by   text,
  created_at   timestamptz not null default now(),
  unique (source_id, url)
);

create index if not exists crawl_queue_pending_idx
  on public.crawl_queue (status, created_at) where status = 'queued';

comment on table public.crawl_queue is
  'Work waiting for the crawler. A student request must never trigger a fetch - the queue is drained by a background worker only.';

create table if not exists public.source_content (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.source_registry(id) on delete cascade,
  url           text not null,
  canonical_url text,
  title         text,
  markdown      text,
  content_hash  text not null,
  simhash       bigint,
  fetched_at    timestamptz not null default now(),
  fetch_method  text check (fetch_method in ('static','browser')),
  rights_flag   text,
  enriched_at   timestamptz,
  unique (source_id, content_hash)
);

create index if not exists source_content_hash_idx    on public.source_content (content_hash);
create index if not exists source_content_simhash_idx on public.source_content (simhash);
create index if not exists source_content_pending_idx on public.source_content (enriched_at) where enriched_at is null;
create index if not exists source_content_trgm_idx
  on public.source_content using gin (markdown gin_trgm_ops);

comment on table public.source_content is
  'What was actually fetched, kept forever as provenance. The crawler is an acquisition tool; the validated question is the truth, and it points back here.';

alter table public.source_registry enable row level security;
alter table public.crawl_queue     enable row level security;
alter table public.source_content  enable row level security;

-- Only an admin manages sources from a browser. The worker uses service_role,
-- which bypasses RLS; crawl_queue and source_content deliberately get no
-- policy at all, so no browser role can read or write them.
drop policy if exists source_registry_admin on public.source_registry;
create policy source_registry_admin on public.source_registry
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Exact hash, then SimHash, then trigram - cheapest test first, and every one
-- of them local.
create or replace function public.is_duplicate_source(
  _content_hash text,
  _markdown     text,
  _simhash      bigint default null,
  _threshold    real   default 0.85
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare hit record;
begin
  select id, url, 'exact hash' as why into hit
    from public.source_content where content_hash = _content_hash limit 1;
  if found then
    return jsonb_build_object('duplicate', true, 'why', hit.why,
                              'of', hit.id, 'url', hit.url);
  end if;

  if _simhash is not null then
    select id, url, 'simhash within 3 bits' as why into hit
      from public.source_content
     where simhash is not null
       and length(replace((simhash # _simhash)::bit(64)::text, '0', '')) <= 3
     limit 1;
    if found then
      return jsonb_build_object('duplicate', true, 'why', hit.why,
                                'of', hit.id, 'url', hit.url);
    end if;
  end if;

  if _markdown is not null and length(_markdown) > 200 then
    select id, url, 'trigram similarity' as why into hit
      from public.source_content
     where markdown is not null
       and similarity(markdown, _markdown) >= _threshold
     limit 1;
    if found then
      return jsonb_build_object('duplicate', true, 'why', hit.why,
                                'of', hit.id, 'url', hit.url);
    end if;
  end if;

  return jsonb_build_object('duplicate', false);
end $function$;

-- SKIP LOCKED so several workers can drain the queue at once without ever
-- handing the same URL to two of them.
create or replace function public.claim_crawl_jobs(_worker text, _limit integer default 5)
returns table(job_id uuid, url text, depth integer, domain text,
              known_dynamic boolean, max_depth integer, rate_limit_per_min integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  with picked as (
    select q.id from public.crawl_queue q
      join public.source_registry s on s.id = q.source_id
     where q.status = 'queued'
       and s.retired_at is null
       and s.rights_flag in ('APPROVED_SOURCE','ORIGINAL_ONLY')
     order by q.created_at
     limit greatest(_limit, 1)
     for update of q skip locked
  )
  update public.crawl_queue q
     set status = 'fetching', claimed_at = now(),
         claimed_by = _worker, attempts = q.attempts + 1
    from picked p, public.source_registry s
   where q.id = p.id and s.id = q.source_id
  returning q.id, q.url, q.depth, s.domain, s.known_dynamic, s.max_depth, s.rate_limit_per_min;
end $function$;

revoke all on function public.is_duplicate_source(text, text, bigint, real) from public, anon, authenticated;
revoke all on function public.claim_crawl_jobs(text, integer)               from public, anon, authenticated;
grant execute on function public.is_duplicate_source(text, text, bigint, real) to service_role;
grant execute on function public.claim_crawl_jobs(text, integer)               to service_role;
