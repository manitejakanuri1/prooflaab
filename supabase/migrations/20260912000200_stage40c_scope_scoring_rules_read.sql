-- The read policy let any signed-in user see every college's scoring
-- overrides, not just the global defaults. Not sensitive data, but
-- least-privilege is the stated principle, and the fix costs nothing —
-- every real reader goes through tpo_scoring_rules() (SECURITY DEFINER,
-- bypasses RLS) anyway, so this only closes a direct-table-read path.
drop policy scoring_rules_read on public.squad_scoring_rules;
create policy scoring_rules_read on public.squad_scoring_rules for select to authenticated
  using (college_id is null or college_id = public.my_college_id());
