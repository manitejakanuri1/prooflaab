// MF-074: a library is proof of its language.
// Run: deno test --allow-env supabase/functions/_shared/skill-map_test.ts
import { assert } from "jsr:@std/assert@1";
import { matchSkills } from "./skill-map.ts";

Deno.test("Pandas counts as Python, so Python is not a gap", () => {
  const r = matchSkills(["Data Science"], ["Pandas"]);
  assert(r.matched_skills.includes("Python"));
  assert(!r.missing_skills.includes("Python"));
  assert(r.per_interest[0].covered);   // Pandas + Python = 2
});

Deno.test("Python alone does not imply Pandas", () => {
  const r = matchSkills(["Data Science"], ["Python"]);
  assert(!r.matched_skills.includes("Pandas"));
});
