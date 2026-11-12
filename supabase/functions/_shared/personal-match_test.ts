// Owner 12 Nov 2026: personal tasks are reused for similar students before AI writes a new one.
import { personalMatch } from "./personal-match.ts";

Deno.test("personalMatch: 2 per shared skill or interest, 1 for the same branch, 0 for nothing", () => {
  const s = { branch: "CSE", key_interests: ["Web"], preferred_skills: ["Python", "React"] };
  const cases: [number, number][] = [
    [personalMatch(s, { branch: "cse", key_interests: [], preferred_skills: ["python"] }), 3],
    [personalMatch(s, { branch: "ECE", preferred_skills: ["Java"] }), 0],
    [personalMatch(s, null), 0],
    [personalMatch({ branch: "CSE", year_of_study: "4th" }, { branch: "cse", year_of_study: "4th", preferred_skills: ["Go"] }), 2],
    [personalMatch({ branch: "CSE", year_of_study: "4th" }, { branch: "ECE", year_of_study: "4th" }), 1],
  ];
  for (const [got, want] of cases) if (got !== want) throw new Error(`got ${got}, want ${want}`);
});
