// S41 BASELINE: the STAGING database API (PostgREST) is publicly invokable (Cloud Run allUsers, ingress all), so a
// signed-out caller can skip the gateway and call it directly as `anon`. On staging (13 Oct 2026) 100 SECURITY
// DEFINER functions are executable by anon. This probes, with NO token: every sensitive table (GET, limit 1) and every
// READ-ONLY (stable) function a signed-out caller can run without arguments. Nothing that can write is called.
// PASS = refused, or no row. The only rows allowed are public settings named in ALLOWED_ROWS.
//
//   node scripts/dev-tools/sidhu_s41_anon_direct_api.mjs --confirm-staging
// Exit 0 all PASS, 1 a FAIL, 3 refused (not staging).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app";
export const TABLES = ["student_profiles", "student_contact", "account_identities", "removed_students", "security_events", "web_sessions",
  "squad_members", "squads", "seasons", "user_roles", "colleges", "recruiters", "startups", "task_submissions", "voice_explanations",
  "notifications", "app_events", "identity_lifecycle", "email_templates", "notification_rules", "squad_name_themes", "tasks",
  "protected_test_accounts", "audit_logs", "llm_usage", "resume_claims", "student_weekly_scores", "squad_matches"];
// Stable, zero-argument functions anon can execute on staging (read-only listing, 13 Oct 2026).
export const STABLE_FUNCTIONS = ["recruiter_home", "recruiter_filters", "my_season_status", "admin_recruiters", "needs_review_submissions",
  "my_shortlists", "my_skills_proved", "my_week", "tpo_attention", "tpo_squad_achievements", "admin_content_library", "tpo_home",
  "tpo_insights", "tpo_reserves", "tpo_college_report", "tpo_placement_report", "tpo_student_filters", "tpo_scoring_rules",
  "tpo_naming_themes", "my_placement_status", "my_rank", "my_squad_achievements", "is_admin", "my_college_id", "viewer_college_id",
  "my_approved_college_ids", "is_verified_recruiter", "my_recruiter_id", "my_season_id"];
/** Public settings: the default branch / squad-name list the import screen shows. */
export const ALLOWED_ROWS = { tpo_naming_themes: (row) => Object.keys(row).every((k) => ["theme", "branch", "customized", "default_theme"].includes(k)) };
const PERSONAL = /@|"(email|work_email|full_name|phone|roll_number|student_name|contact_name)"\s*:\s*"[^"]/i;

/** Pure: PASS when refused or nothing personal came back. */
export function judge(name, status, body) {
  let json = null; try { json = JSON.parse(body); } catch { /* not JSON */ }
  if (status >= 500) return ["FAIL", `server error ${status}`];
  if (status >= 400) return ["PASS", `refused ${status}`];
  if (Array.isArray(json) && json.length) {
    const ok = ALLOWED_ROWS[name] && json.every(ALLOWED_ROWS[name]);
    return ok ? ["PASS", `${json.length} public setting row(s)`] : ["FAIL", `returned ${json.length} row(s) to an anonymous caller`];
  }
  if (PERSONAL.test(body)) return ["FAIL", "personal data in the answer"];
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const filled = Object.entries(json).filter(([k, v]) => k !== "error" && Array.isArray(v) && v.length);
    if (filled.length) return ["FAIL", `non-empty ${filled.map(([k]) => k).join(", ")}`];
  }
  return ["PASS", "no data"];
}

export async function run(fetcher = fetch) {
  const out = [];
  for (const t of TABLES) {
    const r = await fetcher(`${API}/${t}?select=*&limit=1`, { headers: { Accept: "application/json" } });
    out.push([`table ${t}`, ...judge(t, r.status, await r.text()), r.status]);
  }
  for (const f of STABLE_FUNCTIONS) {
    const r = await fetcher(`${API}/rpc/${f}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    out.push([`rpc ${f}`, ...judge(f, r.status, await r.text()), r.status]);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (!process.argv.includes("--confirm-staging")) { console.log("REFUSED: add --confirm-staging (this probes the STAGING database API only)"); process.exit(3); }
  const rows = await run();
  for (const [what, verdict, why, status] of rows) console.log(`${verdict.padEnd(4)} ${String(status).padEnd(3)} ${what.padEnd(34)} ${why}`);
  const fails = rows.filter((r) => r[1] === "FAIL").length;
  console.log(`BASELINE direct database API, signed out: ${rows.length - fails} PASS, ${fails} FAIL (${API})`);
  process.exit(fails ? 1 : 0);
}
