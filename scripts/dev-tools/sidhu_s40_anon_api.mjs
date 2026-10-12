// S40 BASELINE: every gateway address a signed-out visitor can reach, probed on the STAGING site. No browser, no
// login, no write can succeed (every write is sent without a session, and must be refused). Refuses production.
//
//   node scripts/dev-tools/sidhu_s40_anon_api.mjs --confirm-staging [--out dir]
//
// The routes come from web-bff/routes.contract.json (the same file the gateway and website tests read), so a new
// closed route is probed without anyone remembering to add it. On top of that, the addresses that hold the most
// sensitive data are probed by name. Each probe runs twice: with no credentials, and with a forged service token.
// Exit: 0 every probe PASS, 1 a FAIL, 3 refused.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertStaging, redact } from "./sidhu_s32_live_e2e.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FORGED = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwic3ViIjoiYWRtaW4ifQ.forged";
export const LEAK = /Traceback|\bat \w+ \(|file:\/\/\/|\/app\/|PGRST_JWT|_SECRET|BEGIN PRIVATE|postgres(ql)?:\/\/|"stack"\s*:/i;

/** Sensitive addresses probed by name, in addition to one example of each contract route. */
export const SENSITIVE = [
  ["GET", "/api/db/student_profiles?select=id,full_name&limit=1"],
  ["GET", "/api/db/student_contact?select=*&limit=1"],
  ["GET", "/api/db/account_identities?select=*&limit=1"],
  ["GET", "/api/db/removed_students?select=*&limit=1"],
  ["GET", "/api/db/security_events?select=*&limit=1"],
  ["GET", "/api/db/web_sessions?select=*&limit=1"],
  ["GET", "/api/db/squad_members?select=*&limit=1"],
  ["POST", "/api/db/rpc/tpo_students"],
  ["POST", "/api/db/rpc/form_squads"],
  ["POST", "/api/db/rpc/remove_students"],
  ["POST", "/api/db/rpc/admin_set_notification_rule"],
  ["POST", "/api/db/rpc/set_share_voice_audio"],
  ["POST", "/api/functions/scheduled-job?job=nightly-squads"],
  ["POST", "/api/functions/create-student-users"],
  ["POST", "/api/functions/delete-my-account"],
  ["POST", "/api/accounts/remove"],
  ["GET", "/api/files/resumes/00000000-0000-4000-8000-000000000001/resume.pdf"],
  ["POST", "/api/transcriber/transcribe"],
];

/** The probe list: one example per contract route plus the sensitive ones. */
export function probes(contract = JSON.parse(readFileSync(join(ROOT, "web-bff/routes.contract.json"), "utf8"))) {
  const out = [];
  for (const r of contract.routes) {
    const path = r.prefix ? r.example : r.match;
    if (!path) continue;
    out.push({ method: r.method, path, expect: r.anonymous, source: "contract" });
  }
  for (const [method, path] of SENSITIVE) out.push({ method, path, expect: "closed", source: "sensitive" });
  return out;
}

/** Judges one answer. closed: must be 401/403 with no rows. open: must not be a 5xx, leak, or hand out a session/data. */
export function judge(p, status, body, auth) {
  const why = [];
  if (status === 0) why.push("no answer");
  if (status >= 500) why.push(`server error ${status}`);
  if (LEAK.test(body)) why.push("error body leaks internals");
  if (p.expect === "closed") {
    if (![401, 403].includes(status)) why.push(`expected 401/403, got ${status}`);
    if (/^\s*\[\s*\{/.test(body)) why.push("returned rows");
  } else {
    if (p.path === "/api/auth/session" && !/"session"\s*:\s*null/.test(body)) why.push("a signed-out visitor got a session");
    if (p.path === "/api/auth/signup" && status < 400) why.push("public signup is open");
    if (p.path.startsWith("/api/public/portfolio/") && status === 200 && /"(email|phone|password)"/i.test(body)) why.push("public portfolio exposes contact data");
    if (p.method !== "GET" && status >= 200 && status < 300 && !["/api/auth/logout", "/api/auth/password-reset/request"].includes(p.path))
      why.push(`a signed-out ${p.method} succeeded (${status})`);
  }
  return { ...p, auth, status, verdict: why.length ? "FAIL" : "PASS", why: why.join("; ") };
}

export async function run(base, fetcher = fetch) {
  const results = [];
  for (const p of probes()) {
    for (const auth of ["none", "forged"]) {
      let status = 0, body = "";
      try {
        const res = await fetcher(`${base}${p.path}`, {
          method: p.method, redirect: "manual",
          headers: { "Content-Type": "application/json", Origin: base, ...(auth === "forged" ? { Authorization: FORGED } : {}) },
          body: p.method === "GET" ? undefined : (p.path === "/api/auth/password-reset/request" ? JSON.stringify({ email: "nobody@invalid.test" }) : "{}"),
        });
        status = res.status; body = (await res.text()).slice(0, 4000);
      } catch (e) { body = String(e); }
      results.push(judge(p, status, body, auth));
    }
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2); const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  let base;
  try { base = assertStaging(process.env.E2E_BASE ?? "https://prooflab-staging.web.app"); if (!a.includes("--confirm-staging")) throw new Error("add --confirm-staging"); }
  catch (e) { console.log(`REFUSED: ${e.message}`); process.exit(3); }
  const out = val("--out") ?? "e2e-out/s40-anon"; mkdirSync(out, { recursive: true });
  const results = await run(base);
  for (const r of results) console.log(`${r.verdict.padEnd(4)} ${r.auth.padEnd(6)} ${String(r.status).padEnd(3)} ${r.method.padEnd(4)} ${redact(r.path)}${r.why ? `  <- ${r.why}` : ""}`);
  const fails = results.filter((r) => r.verdict === "FAIL").length;
  writeFileSync(join(out, "anon-api.json"), JSON.stringify({ base, at: new Date().toISOString(), results }, null, 1));
  console.log(`BASELINE anonymous API: ${results.length - fails} PASS, ${fails} FAIL (${base})`);
  process.exit(fails ? 1 : 0);
}
