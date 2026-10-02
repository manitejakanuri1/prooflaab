# Cleanup and completion order — 3 Oct 2026 (recommendation only; nothing executed)

Every phase: plan → owner "yes" → branch → staging → evidence → production with approval → verification.

| Phase | Goal | Contents (IDs) | Exit evidence |
|---|---|---|---|
| 0 | Freeze + checkpoint | Tag current main `d736e4d`; restore protected test identities (student, company) in a **dedicated test college** the team does not use; agree "production is not the test bench" (N1, N19) | healthcheck 24/24, bug finder green, authz all roles |
| 1 | Lock the canonical product | Owner decisions: required voice after Submit (N4), one recording per task, voice length gating (N5), Lot personalisation (N6), GitHub/LinkedIn links, `/recruiter/:linkId`, Migration 46 | written decision record |
| 2 | Dead code, zero behaviour change | 30 orphan/unreachable files + dead branches (L8, D5 parts) | build, unit, typecheck, browser smoke unchanged |
| 3 | Replace mixed screens | Company submissions/stats/activity on task_submissions (**L1, P1**); Build-log (Entries) = work + voice entries; task status/roadmap from task_submissions; Portfolio from passed work; admin stats/People/Task Oversight; Trust & XP → XP-only; squad names RPC (N3); "Your tasks" in Roadmap (N7) | staging cross-role E2E (company post → student submit → company review) |
| 4 | Remove visible legacy UX | Trust Score (student/TPO/filters), Cosigns, LeetCode/HackerRank, Privacy proof section, Admin Proof Review, `/review-proofs` (L2, L3) | screenshots + bundle grep |
| 5 | Remove old endpoints | 9 functions from SLUGS (L6); `/ready` 31/31; authz_test + attack-surface list updated | 0 callers proven again; deploy staging → prod |
| 6 | Retire DB objects | Migration: current functions without proof_uploads/trust_score (L7), voice guard + enqueue `proof_id`, drop legacy RPCs/triggers; later drop 12 tables + column; remove orphan storage objects (N2, D5) | staging rehearsal with ROLLBACK, backup, prod verify |
| 7 | Finish product integrations | Required voice flow (N4/N5), Build-log linkage, recruiter proof profile on current evidence (F12 + 46 decision) | staging E2E with real sign-in |
| 8 | Security hardening | F4 (server-side verified email + link rule), F1 (asymmetric signing, service identity), F8/F9/F10 (runner), F11 (immutable evidence), F2, F5, F7 (OIDC), N10 (runner internal), N14 (compute SA grants) | negative tests + staging probes |
| 9 | Reliability / cost / observability | **F3 first** (rate limits + llm_usage working, alert if not writing), F6 (sync threshold), F14 (timeouts), F19, F20, alerts for mass removal and AI logging | rows in llm_usage/rate_limits; alert fires in test |
| 10 | Performance / load | staging matrix 100 → 250 → 500 (F21, U6) incl. recruiter search seed | p95/5xx/DB metrics recorded |
| 11 | Release-candidate rehearsal | F16 (deploy tested artifact, all tests in CI), F17 (one migration folder + applied table), F18 (IaC for the core), docs refresh (D1, D2, D4, CLAUDE.md drift) | full gate list green |
| 12 | Controlled production rollout | explicit owner approval per change | post-deploy checks |

Why F3 sits early inside phase 9 and can be pulled forward: it is cheap, it carries no product risk, and it removes a live
cost/abuse exposure. It can be done right after phase 0 if the owner agrees.
