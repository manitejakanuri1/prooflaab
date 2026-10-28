// MF-022 check (TEST): what a company user and a signed-out visitor receive about a student.
// Run: E2E_COMPANY_EMAIL=... E2E_COMPANY_PASSWORD=... node scripts/dev-tools/company_view_check.mjs
import { chromium } from "playwright";
import { cookieSignIn, credentialsFor } from "./bff_login.mjs";
const BASE = "https://prooflab-staging.web.app";
const STUDENT = "f21270d0-b946-417e-987c-3b3953995a56", SLUG = "p-b181b36f0d0c";
const LOW = 50; // voice scores under this are "failed" for outside viewers
const problems = [];
const browser = await chromium.launch();
const anon = await browser.newContext();
const pub = await (await anon.request.get(`${BASE}/api/public/portfolio/${SLUG}`)).json();
for (const w of pub.work ?? []) if (w.explanation_score != null && w.explanation_score < LOW) problems.push(`public: low voice score ${w.explanation_score} on "${w.title}"`);
const anonSc = await anon.request.get(`${BASE}/api/db/public_resume_scorecards?student_id=eq.${STUDENT}&select=*`);
const anonRows = anonSc.ok() ? await anonSc.json() : [];
if (Array.isArray(anonRows) && anonRows.some((r) => r.roadmap || r.skill_gap)) problems.push("public: scorecard roadmap/skill_gap readable signed out");
console.log(`signed-out: portfolio work ${pub.work?.length ?? "?"} rows, scorecard view ${anonSc.status()}`);

const co = await browser.newContext();
await cookieSignIn(co, BASE, credentialsFor("company"));
const prof = await (await co.request.post(`${BASE}/api/db/rpc/recruiter_proof_profile`, { data: { _student_id: STUDENT } })).json();
if (prof.error) problems.push(`company profile error: ${prof.error}`);
for (const v of prof.explanations ?? []) {
  if (v.communication_notes) problems.push(`company: coaching note "${String(v.communication_notes).slice(0, 50)}..."`);
  if (v.communication_score != null && v.communication_score < LOW) problems.push(`company: low voice score ${v.communication_score}`);
}
for (const s of prof.skills ?? []) if (s.status === "needs_improvement") problems.push(`company: weak skill ${s.skill}`);
if (prof.scorecard?.skill_gap) problems.push(`company: skill_gap ${JSON.stringify(prof.scorecard.skill_gap).slice(0, 80)}`);
const coSc = await (await co.request.get(`${BASE}/api/db/public_resume_scorecards?student_id=eq.${STUDENT}&select=*`)).json();
for (const r of Array.isArray(coSc) ? coSc : []) {
  if (r.roadmap) problems.push(`company: coaching roadmap "${String(r.roadmap).slice(0, 60)}..."`);
  if (r.skill_gap) problems.push(`company: scorecard view skill_gap`);
}
// Page check: the public page must not show the roadmap heading.
const page = await co.newPage();
await page.goto(`${BASE}/portfolio/${SLUG}`, { waitUntil: "networkidle" });
const body = await page.locator("body").innerText();
if (/Improvement roadmap/i.test(body)) problems.push("page: 'Improvement roadmap' shown to company");
console.log(`company: profile keys ok=${!prof.error}, explanations ${prof.explanations?.length ?? 0}, scorecard rows ${Array.isArray(coSc) ? coSc.length : "?"}`);
await browser.close();
console.log(problems.length ? `FAIL (${problems.length})\n- ${problems.join("\n- ")}` : "PASS: no coaching notes, weak areas or low scores");
process.exit(problems.length ? 1 : 0);
