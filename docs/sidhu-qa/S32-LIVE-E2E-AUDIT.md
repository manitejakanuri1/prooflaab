# S32 — Independent live E2E QA: consolidated audit (10 Oct 2026)

Source under test: `manitejakanuri1/prooflaab` @ **`5bef9577441285480285e19643df695470826fee`**, verified on GitHub; parent is TEJA's RC `c2a4fe8`.
Worktree `prooflaab-sidhu-claude-s32`, branch `fix/sidhu-s32-live-e2e-suite-2026-10-10` (local, not pushed).

## Answer first

| Question | Answer |
|---|---|
| Current access | **GitHub: OK** (`Sidhu-king`, repo scope, push). **Google Cloud: OK** (`deploy.openfloor@gmail.com`, project `prooflab-508214`; read-only use only). |
| Is `5bef957` deployed on staging? | **NO.** Staging's frontend is **`59235dd`**, 13 commits behind `5bef957`, proven by reproducible build. Its backend images carry no commit, and `functions` was built before `c2a4fe8` existed. |
| Authenticated live E2E | **ACCESS_BLOCKED**: there are no **authorized** staging accounts (see §3). Not run. |
| Live checks actually run | Signed-out, read-only, on `59235dd`: **100 / 100 screen rows PASS** (every dashboard URL sends a signed-out visitor to `/auth` with no data answered). |
| Control matrix | **1,280 rows** from `5bef957`'s source. **100 PASS (signed-out only), 1,180 NOT_TESTED.** No untested control is counted as PASS. |
| Suite for TEJA | **Ready**: `scripts/dev-tools/sidhu_s32_live_e2e.mjs`, one command, staging-only; 9 / 9 unit tests (§5). |

**There is no live QA PASS for `5bef957`.** It is not deployed, and no authorized accounts exist.

## 1. Deployed state, verified separately from source (read-only)

| Component | Live on staging | Commit | How proven |
|---|---|---|---|
| Frontend, Firebase Hosting `prooflab-staging` | version `939a668ef6990b38`, released 2026-10-08 09:48 UTC by `deploy.openfloor@gmail.com`, no message or labels; entry `index-BbfwBTK1.js` | **`59235dd`** ("fix(college): remove duplicate suspend action", 8 Oct 14:47 IST) | `vite build --mode staging` of a clean `git archive 59235dd` yields `index-BbfwBTK1.js`; 9 neighbouring commits and `851cf7e` / `c2a4fe8` / `5bef957` do not. **Method control:** rebuilding `main` `d814d5d` in production mode yields `index-BGNrS8VU.js` = production's live entry. |
| `prooflab-staging-functions` | rev `00075-git`, image `sha256:d0e362e7…`, built 2026-10-09 05:53 UTC (source upload) | **unknown**; built before `c2a4fe8` (09:40 UTC) | no commit label on image or revision |
| `prooflab-staging-web-bff` | serving `00004-9nn` (7 Oct); **newer `00005-wuh` is ready but gets no traffic** | unknown | traffic split read |
| `prooflab-staging-code-runner` | serving `00006-6fv`; **newer `00007-xop` gets no traffic** | unknown | same |
| accounts / auth-bridge / files / api / transcriber / worker | images from 3–8 Oct | unknown | no labels |
| Database | migration 104 not applied (S31); 93 / 103 state: see the S31 discrepancy note (unreconciled) | — | earlier read-only ledger query |

**For the expected release `5bef957`, the staging build must show `index-D61l7bit.js`.** It shows `index-BbfwBTK1.js` (= `59235dd`), so **MISMATCH**.

**Release-traceability finding:** no image, revision or Hosting release records its source commit. Fix: label each deploy with the SHA, e.g. `gcloud run deploy … --labels=commit-sha=<sha>` and `firebase deploy -m "<sha>"`. Then this proof takes one lookup instead of rebuilds.

## 2. The matrix

`e2e-out/s32/` (in the review ZIP) holds `plan/matrix.csv` (all 1,280 rows) and `anon-live/matrix.csv` (with live results).

Columns: **Role | Page | Control | Class | Expected route | API | DB effect | Live result | Status | Evidence**. The API and DB-effect columns come from `5bef957`'s source (handler → RPC / table / function, with insert/update/delete).

| Class | Rows | How the live suite treats it |
|---|---|---|
| SCREEN | 100 | open, unauthorized / 5xx / HTML-from-API check, refresh persistence, offline + retry recovery, screenshot |
| SAFE | 317 | handler provably has no backend effect (tabs, navigation, state setters): clicked live, URL + API calls recorded |
| READ | 60 | handler reads the backend: blocked until a recipe covers it |
| WRITE | 424 | handler or label writes: run **only** through a recipe with disposable fixtures (`--allow-writes`); DB effect via read-only SQL (`--db-verify`) |
| UNSURE | 359 | handler calls a helper the static trace cannot see: never auto-clicked; blocked until a recipe covers it |
| DEAD | 20 | visible button with **no handler**: clicked live; FAIL if nothing happens |

| Role | Rows | Live now |
|---|---|---|
| admin | 317 | signed-out screen rows only |
| tpo (college) | 175 | same |
| company | 100 | same |
| student / established (fresh / existing) | 2 × 344 | same |

**Live result by row: PASS 100 (signed-out only) · FAIL 0 · BLOCKED 0 · NOT_TESTED 1,180.**

## 3. Why authenticated live E2E is ACCESS_BLOCKED

- `docs/STAGING-TEST-FIXTURES.md` at `c2a4fe8` still says: *"these test Identity logins are not available yet… Creating them is an owner decision: staging and production share one Google Identity Platform pool."*
- Secrets `prooflab-staging-{admin,college,student}-password`, `prooflab-company-test-password`, `prooflab-e2e-password`, `prooflab-testusers-password` and `prooflab-smoke-student-password` exist. All were created **19 Sep – 2 Oct**, before the managed-accounts migrations 95–102 (7–8 Oct) and before that statement. The t01–t18 / e2e logins were removed on 30 Sep.
- I did **not** read or use them. A stale secret is not an authorized account, and the pool is shared with production.

**What unblocks it:** the owner approves five staging test accounts mapped to staging fixture rows, and TEJA passes them to the suite as `E2E_<ROLE>_EMAIL / _PASSWORD / _USER_ID`.

## 4. Broken interactions (evidence)

| Control | Role | Evidence | Live confirmation |
|---|---|---|---|
| **Delete Account** (enabled, red, no handler) | student | source `StudentSettingsPage.tsx:675`; S28/S31 browser: click does nothing | BLOCKED (auth) |
| **Configure Email Templates** (no handler) | admin | `SystemSettings.tsx:229`; S28/S31 | BLOCKED (auth) |
| **Manage Notification Rules** (no handler) | admin | `SystemSettings.tsx:235`; S28/S31 | BLOCKED (auth) |
| **Voice Play** on candidate explanations (no handler, no audio in data) | company | `ProofProfile.tsx:144`; S28/S31 | BLOCKED (auth) |
| "All Announcements" (inert filter button) | admin | `ManageAnnouncementsPage.tsx:234` | BLOCKED (auth) |
| Company "Delete Account", student "Under Review", photo "Frames" | company / student / all | rendered **disabled** by design | the live run will mark these PASS if still disabled |

The first four are **unresolved launch decisions for the owner** (S31 handoff §3).

Other findings:
- **Not integrated:** `5bef957` / `c2a4fe8` still carry the old `staging_browser_e2e.mjs` / `bff_login.mjs`. They default to a local server that has no `/api`, never check *who* signed in, and leak browsers on a failed login. The S26 hardening was never merged. The S32 suite carries its own hardened login.
- **Traffic not on latest:** `web-bff` and `code-runner` on staging serve older revisions than their latest ready ones. Intentional or not, the release notes should say which.

## 5. The cloud-executable suite (for TEJA)

`scripts/dev-tools/sidhu_s32_live_e2e.mjs` is one file. It reuses `sidhu_s32_inventory.mjs` (S28's inventory, regenerated on the release source).

| Guarantee | How |
|---|---|
| Staging only | refuses `prooflab.co.in`, the production Firebase site, unknown hosts and plain http; needs `--confirm-staging` |
| Right build | `--expect-entry` vs the live `index-*.js`; a mismatch means exit 4, not release evidence |
| Right person | real form → BFF → HttpOnly + Secure cookie → `/api/auth/session` must equal `E2E_<ROLE>_USER_ID` and the managed role, else that role FAILS before any click |
| No fake success | real browser and real backend; PASS only when the control was exercised and every check held |
| Safety | auto-clicks SAFE and DEAD controls only; writes only via recipes, with `--allow-writes` and disposable fixture ids; DB checks are a single SELECT inside a read-only transaction through `staging_sql.sh` |
| Isolation | each role opens the other dashboards (must be sent away) and calls other roles' RPCs with its own cookie (must be refused or empty) |
| Failure / retry | each screen goes offline in a real browser, then back online, and must recover without a crash or blank page |
| Privacy | inputs masked in screenshots; emails, tokens, cookies and passwords redacted from every message |

**Write recipes** (UI → expected request → DB proof):
- student certification add → refresh → delete (self-cleaning);
- student written submission on a fixture task (`task_submissions` row);
- TPO "Send reminder" to a quiet fixture student (`interventions` row);
- company "Shortlist" of a fixture candidate (`recruiter_shortlists` row);
- admin "Approve" a fixture `needs_review` submission (status `passed`).

Not yet covered by a recipe (stays BLOCKED): college manual Assign Task, CSV import, admin user approval and suspension, voice recording, resume upload. Those need owner-approved disposable fixtures first.

**TEJA runbook:**
1. Deploy `5bef957` to **staging only**, after reconciling the 93 / 103 ledger discrepancy (S31 §4). Apply 103 then 104; deploy functions; deploy the frontend. Label each deploy with the SHA.
2. Confirm the frontend: `curl -s https://prooflab-staging.web.app/ | grep -o 'index-[A-Za-z0-9_-]*\.js'` must print `index-D61l7bit.js`. A different `5bef957` build environment can change it; then rebuild with `vite build --mode staging` from `git archive 5bef957` and use that name.
3. Prepare the owner-approved staging accounts and disposable fixtures: `E2E_FIXTURE_WRITTEN_TASK_ID`, `E2E_FIXTURE_QUIET_STUDENT_NAME/_ID`, `E2E_FIXTURE_CANDIDATE_NAME/_ID`, `E2E_FIXTURE_REVIEW_SUBMISSION_ID`.
4. Run: `node scripts/dev-tools/sidhu_s32_live_e2e.mjs --confirm-staging --expect-entry index-D61l7bit.js --allow-writes --db-verify --out e2e-out/s32/release-5bef957`
5. Send me `matrix.json`, `matrix.csv` and the screenshots. I will review them against Cloud Run logs (request ids) and a read-only ledger and row check.

## 6. Tests of the suite itself

| Check | Result |
|---|---|
| `node --test scripts/dev-tools/sidhu_s32_live_e2e.test.mjs` | **9 / 9**: production refusal, redaction, classification (a writer is never auto-clicked; the known dead buttons are never SAFE), plan covers every role with zero PASS, SELECT-only DB guard, every recipe's proof is one SELECT, provenance, exit codes, CLI refusals |
| Plan mode on `5bef957` | 1,280 rows, exit 2 (incomplete by design) |
| Anonymous mode live on staging | 100 / 100 screen rows, provenance MISMATCH, exit 4 |

Limits:
- Matching a live control to a source control uses its visible label; a label-less or long-label control is BLOCKED, never guessed.
- UNSURE and READ controls need recipes before they can be counted.
- Running the suite twice creates new rows only through the recipes; each is tagged with a run id.

## 7. Recommendation

- **Release QA status for `5bef957`: NOT VERIFIED / BLOCKED.** It is not deployed on staging, and no authorized accounts exist.
- **Next:** TEJA runbook steps 1–5. I will retest the exact deployed build after each release, using `--expect-entry`.
