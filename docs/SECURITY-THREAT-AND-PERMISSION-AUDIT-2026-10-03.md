# Security threat and permission audit — 3 Oct 2026 (read-only)

No exploitation was performed. RUN = executed now; SRC/CFG/DATA = read now; EARLIER = 30 Sep–2 Oct.

## 1. Authentication chain

Identity Platform (email/password, Google) → ID token (RS256, Google keys) → `prooflab-auth-bridge`
verifies RS256 (`auth-bridge/verify.ts:55` rejects non-RS256 / alg confusion) → `resolve_account`
maps provider uid to app uuid (`account_identities`) → bridge signs an **HS256** ticket (TTL 3600 s,
`TOKEN_TTL`) carrying `sub`, `role`, `email`, `email_confirmed` → PostgREST/files/functions verify HS256
with the shared secret → RLS.

| Topic | Finding | Evidence |
|---|---|---|
| Signing | Symmetric HS256; the same secret also mints `service_role` (`backend.ts:55-71`) — **F1 P1** | SRC |
| Secret holders | 9 runtime identities + compute SA (Cloud Build) | CFG |
| Email verification | Enforced only in the browser; bridge passes `email_confirmed` but nothing on the server refuses unconfirmed accounts — **F4 P1** | SRC |
| Account linking | CSV import links an existing student account by email without verification check | SRC `create-student-users:141-220` |
| Roles | Browser self-claims student/college_admin/startup/recruiter (RLS policy); admin not claimable; college/recruiter powers require approval — **F5 P3** | SRC |
| Token storage | localStorage in the browser (`identity.ts:100`); 1-hour tickets | SRC |
| Logout / switching | Recovery records are account-bound (Step 6 lifecycle rounds) | EARLIER (harness tests) |

## 2. Authorization matrix (role × resource)

| Resource | Anonymous | Student | College | Company | Admin | Evidence |
|---|---|---|---|---|---|---|
| Own profile / tasks / submissions / voice | ✖ | own | own college | ✖ | all | EARLIER authz 58/58 (2 Oct); RUN 66/66 anon |
| Other students' rows | ✖ | ✖ | own college | ✖ | all | EARLIER |
| College reports | ✖ | ✖ (fixed, Migration 49) | ✔ | ✖ | via college | EARLIER |
| Private files (voice, resumes) | ✖ | own folder | via grants | ✖ (404) | ✔ | EARLIER |
| Write scores / submissions | ✖ | ✖ (no policy; definer RPC only) | ✖ | ✖ | ✖ | G01 audit F8 |
| Server-only RPCs | ✖ | ✖ | ✖ | ✖ | ✖ | EARLIER |
| Private worker | ✖ | ✖ | ✖ | ✖ | ✖ | CFG IAM (tasks-invoker only) |
| Overwrite/delete own scored audio | — | **✔ (F11)** | — | — | — | SRC |
| Score own self-reported (browser) voice | — | **✔ (F12)** | — | — | — | SRC |

Not re-tested today: student and company rows (test logins deleted, N1).

## 3. Threat checklist

| Threat | Status | Evidence / note |
|---|---|---|
| Broken access control / IDOR / BOLA | Tested negative paths pass | RUN 66/66; EARLIER 58/58 |
| Cross-college leakage | One leak found and fixed (G28) | EARLIER |
| Privilege escalation via roles | Gated (F5) | SRC |
| service_role misuse / token forgery | Risk via shared secret (F1) | SRC/CFG |
| JWT alg confusion | Mitigated (RS256-only verify; HS256-only on PostgREST side) | SRC |
| Token replay | 1-hour bearer tickets; no binding | SRC |
| XSS / stored XSS | NOT TESTED (React escapes by default; no dangerouslySetInnerHTML audit done) | NT |
| SQL injection | PostgREST + parameterised RPCs; no string-built SQL found in functions | SRC (spot) |
| Command injection | Code runner runs student code by design; isolation gaps F8/F9 | SRC |
| Path traversal | files-service owner-folder rule; earlier proposal to enforce path rule in DB (not applied) | SRC/EARLIER |
| SSRF | crawler fetches arbitrary registered URLs (admin-curated) — NOT TESTED | SRC |
| CORS | request-specific origins, no `*` | EARLIER |
| Malicious / oversized uploads | transcriber 15 MB cap; files-service limits NOT TESTED | SRC |
| Rate-limit bypass / DoS | **no limits active (F3)** | DATA |
| Brute force / enumeration | Identity Platform settings UNKNOWN (U4) | — |
| Scheduler spoofing | static shared secret (F7) | SRC |
| Queue abuse | worker private; enqueue idempotent per key | EARLIER |
| AI prompt injection | single-prompt design (F14) | SRC |
| Code runner escape / metadata theft | runner SA has no roles; egress open; leftover processes (F8/F9) | SRC/CFG |
| Secret leakage | see secrets audit; no secrets committed (history scan EARLIER) | EARLIER |
| Public code fallback leakage | F10 | SRC |

## 4. Secrets (values never printed)

| Secret / key | Location | Committed? | Risk | Note |
|---|---|---|---|---|
| `prooflab-jwt-secret` | Secret Manager | no | High (F1) | 10 readers |
| `prooflab-db-uri` | Secret Manager | no | High | rt-api + compute SA |
| `deepseek-api-key`, `resend-api-key`, `github-pat`, `code-runner-secret`, `webhook-secret` | Secret Manager | no | Medium | compute SA still reads all (N14) |
| `GOOGLE_API_KEY` on functions | **plain env var** | no | Low | equals the **public browser key** (RUN comparison, value not printed); used for Identity signUp/update in `backend.ts`; key is unrestricted (G27 accepted) |
| Browser Firebase key | committed in `.env.production` / scripts | yes | Low | public by design |
| Test-login passwords | Secret Manager | no | Low | |

## 5. Severity summary
P1: F1, F3, F4, F8 (+ L1 functional). P2: F2, F6, F9, F10, F11, F12, F14, F15, N14. P3: F5, F7, N10.
