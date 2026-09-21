grant select on public.skill_aliases to public, authenticated, anon, service_role;
grant select on public.topic_links to service_role;
notify pgrst, 'reload schema';
