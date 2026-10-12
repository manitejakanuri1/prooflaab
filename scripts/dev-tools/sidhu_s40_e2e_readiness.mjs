// S40: is the authenticated staging E2E able to run? Reads the secret and variable NAMES the workflow needs from
// .github/workflows/staging-live-e2e.yml itself, asks GitHub which exist in the "staging-e2e" environment (names only:
// GitHub never returns secret values), and prints exactly what is missing and the command that adds each one.
//
//   node scripts/dev-tools/sidhu_s40_e2e_readiness.mjs [--repo owner/name]
//
// Adding a value: `gh secret set NAME --env staging-e2e --repo <repo>` prompts for it, so it is typed into gh, never
// shown, never put on a command line or in a file. Exit 0 ready for the read-only pass; 2 not ready.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ENV = "staging-e2e";
export const ROLES = ["ADMIN", "TPO", "COMPANY", "STUDENT", "ESTABLISHED"];

/** The secret names the workflow reads, split into what each pass needs. */
export function requirements(workflow = readFileSync(join(ROOT, ".github/workflows/staging-live-e2e.yml"), "utf8")) {
  const secrets = [...new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
  const vars = [...new Set([...workflow.matchAll(/vars\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
  const login = ROLES.flatMap((r) => ["EMAIL", "PASSWORD", "USER_ID"].map((k) => `E2E_${r}_${k}`));
  return {
    secrets, vars,
    readOnly: login,                                                           // pass 1: sign in, every screen, no writes
    writes: secrets.filter((s) => s.startsWith("E2E_FIXTURE_") || s === "E2E_RESEND_READ_KEY"),   // pass 2
    destructive: secrets.filter((s) => s.startsWith("E2E_DISPOSABLE_")),     // pass 3, disposable identity only
    provenance: vars,                                                          // revisions + --db-verify
  };
}

/** Pure: what is missing for each pass, given the names that exist. */
export function readiness(req, haveSecrets, haveVars, envExists) {
  const miss = (names, have) => names.filter((n) => !have.has(n));
  return {
    environment: envExists,
    readOnly: miss(req.readOnly, haveSecrets),
    writes: miss(req.writes, haveSecrets),
    destructive: miss(req.destructive, haveSecrets),
    provenance: miss(req.provenance, haveVars),
  };
}

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2); const i = a.indexOf("--repo");
  const repo = i >= 0 ? a[i + 1] : "manitejakanuri1/prooflaab";
  const req = requirements();
  const env = gh(["api", `repos/${repo}/environments/${ENV}`, "--jq", ".name"]);
  const sec = env.ok ? gh(["api", `repos/${repo}/environments/${ENV}/secrets`, "--paginate", "--jq", ".secrets[].name"]) : { out: "" };
  const vr = env.ok ? gh(["api", `repos/${repo}/environments/${ENV}/variables`, "--paginate", "--jq", ".variables[].name"]) : { out: "" };
  const r = readiness(req, new Set(sec.out.split(/\s+/).filter(Boolean)), new Set(vr.out.split(/\s+/).filter(Boolean)), env.ok);
  console.log(`environment "${ENV}": ${r.environment ? "exists" : "MISSING"}`);
  for (const [pass, list] of [["pass 1 read-only (5 roles sign in)", r.readOnly], ["pass 2 writes on fixtures", r.writes],
                              ["pass 3 destructive (disposable identity)", r.destructive], ["provenance (QA identity variables)", r.provenance]])
    console.log(`${list.length ? "MISSING" : "ready  "}  ${pass}${list.length ? `: ${list.length} - ${list.join(", ")}` : ""}`);
  if (!r.environment) console.log(`\ncreate it (owner):  gh api -X PUT repos/${repo}/environments/${ENV}`);
  const add = [...r.readOnly, ...r.writes, ...r.destructive];
  if (add.length) console.log(`\nadd each (owner; gh prompts for the value, nothing is shown):\n${add.map((n) => `  gh secret set ${n} --env ${ENV} --repo ${repo}`).join("\n")}`);
  if (r.provenance.length) console.log(`\nvariables (owner):\n${r.provenance.map((n) => `  gh variable set ${n} --env ${ENV} --repo ${repo}`).join("\n")}`);
  process.exit(r.environment && !r.readOnly.length ? 0 : 2);
}
