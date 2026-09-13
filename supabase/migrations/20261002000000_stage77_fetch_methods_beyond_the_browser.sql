-- source_content may now say where it actually came from.
--
-- fetch_method could only be 'static', 'browser' or 'manual', from when the
-- crawler had exactly two ways to read a page: a plain GET, or a local Chromium
-- driven by Crawl4AI.
--
-- The browser is gone. It meant downloading Chromium on every CI run and it only
-- ever handled web pages, while the material worth asking students about also
-- lives in GitHub readmes, YouTube transcripts, Reddit threads and RSS feeds.
-- Each of those is now read over plain HTTP, and each records itself:
--
--   web        a page through Jina Reader, which returns markdown already
--   web-raw    the page's own HTML, used when Jina is unavailable
--   github     a repository readme through the public API
--   youtube    a video transcript
--   reddit     a thread through Reddit's own JSON view
--   rss        a feed, flattened into its entries
--
-- 'static', 'browser' and 'manual' stay allowed. Rows collected before this
-- change carry them, and rewriting history to fit a new vocabulary would destroy
-- the record of how each piece was actually obtained.

begin;

alter table public.source_content
  drop constraint if exists source_content_fetch_method_check;

alter table public.source_content
  add constraint source_content_fetch_method_check
  check (fetch_method = any (array[
    -- how content is collected now
    'web'::text, 'web-raw'::text, 'github'::text,
    'youtube'::text, 'reddit'::text, 'rss'::text,
    -- how it was collected before, kept so existing rows remain valid
    'static'::text, 'browser'::text, 'manual'::text
  ]));

do $$
declare
  bad integer;
begin
  select count(*) into bad
    from public.source_content
   where fetch_method is not null
     and fetch_method <> all (array['web','web-raw','github','youtube','reddit','rss',
                                    'static','browser','manual']);
  if bad > 0 then
    raise exception '% existing rows have a fetch_method the new rule rejects', bad;
  end if;

  raise notice 'fetch_method now accepts the platform readers, and every existing row still fits';
end $$;

commit;
