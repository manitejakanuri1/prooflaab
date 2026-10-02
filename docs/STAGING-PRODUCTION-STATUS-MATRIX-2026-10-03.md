# Staging / production status matrix — 3 Oct 2026

Legend: ✔ proven (with tag) · ✖ no · ~ partial · ? unknown. Tags: RUN now, CFG/DATA now, EARLIER (30 Sep–2 Oct, not re-run).

| Feature | Code exists | Automated tests | Staging deployed | Staging E2E | Prod deployed | Prod verified |
|---|---|---|---|---|---|---|
| Auth (Identity + bridge) | ✔ | Deno `bridge_test.ts` (not in CI) | ✔ | ✔ EARLIER | ✔ CFG | ✔ EARLIER (4 roles); RUN 66/66 negative |
| Resume flow | ✔ | ~ | ✔ | ? | ✔ | ~ EARLIER (deep bug finder 6/6, 30 Sep) |
| Calibration / claims | ✔ | ✖ | ✔ | ? | ✔ | ? |
| Floor / Daily Lot | ✔ | ✖ | ✔ | ✔ EARLIER | ✔ CFG scheduler | ✔ EARLIER |
| Written task + scratchpad | ✔ | ✔ unit (writtenSubmitBody, scratch) | ✔ | ✔ EARLIER | ✔ | ✔ EARLIER (1 Oct) |
| Code runner | ✔ | ✖ (no runner tests) | ✔ same design | ✔ EARLIER load (40 at once) | ✔ CFG | ✔ EARLIER Run/Submit; F8–F10 open |
| Voice async + scoring | ✔ | ✔ unit + Deno + 1 Python (Python not in CI) | ✔ CFG same image `g1w` | ✔ EARLIER (reaper fixture, 10-recording load) | ✔ CFG | ✔ EARLIER (scored 72, 1 Oct) |
| Build-log | ✔ | ✔ unit (status/provenance) | ✔ | ✔ EARLIER | ✔ | ~ EARLIER (voice card); legacy part |
| Roadmap / Tracks | ✔ | ✖ | ✔ | ? | ✔ | ✔ EARLIER (healthcheck) |
| Squad / seasons | ✔ | ✖ | ✔ | ? | ✔ CFG jobs | ~ (jobs run OK; names bug N3) |
| TPO dashboard | ✔ | ✖ | ✔ | ? | ✔ | ✔ EARLIER (Insights 2 Oct) |
| Recruiter / Company | ✔ | ✖ | ✔ | ✔ EARLIER (6K verified-recruiter fixture) | ✔ | ~ EARLIER (screens 12/12); submissions BROKEN (L1) |
| Admin | ✔ | ✖ | ✔ | ? | ✔ | ~ EARLIER (dashboard loads) |
| Storage (files service) | ✔ | ✖ | ✔ | ✔ EARLIER (cross-student 404) | ✔ | ✔ EARLIER (company 404 / owner 200) |
| Notifications (email via Resend, in-app) | ✔ | ✖ | ? | ? | ✔ | ~ (welcome email sent on import, EARLIER) |
| Scheduler jobs | ✔ | ✖ | 1 staging job | ✔ (reaper) | ✔ CFG 12 jobs, all last code 0 | ✔ CFG |
| AI (DeepSeek) | ✔ | ~ (voiceScore unit) | ✔ | ✔ | ✔ CFG key | ~ works; **usage not logged** (F3 DATA) |
| Rate limits / cost controls | ✔ code | ✖ | ? | ? | ✔ deployed | **✖ not active (F3 DATA: rate_limits 0)** |
| Observability (27 alerts, 8 uptime) | ✔ | — | — | — | ✔ CFG (1 Oct) | ✔ EARLIER (incidents fired) |
| Backups / restore | — | — | — | — | ✔ CFG | ✔ restore drill 9 min 28 s (EARLIER, G02) |
| Migrations 41–45, 47, 48, 49 | ✔ | self-checks | 41–44, 47, 48, 49 ✔; **45 original (unfixed)** | ✔ rehearsals | ✔ (45 = corrected 6DD, byte-identical, G01) | ✔ G01 audit |
| Migration 46 | ✔ prepared | rehearsal | **original (broken) 46 on staging** | rehearsed | ✖ not applied (on hold) | — |

## Deployment drift (CFG now)

| Item | Staging | Production | Drift |
|---|---|---|---|
| functions image | `b101fcdc…` | `b101fcdc…` | none |
| transcription-worker image | `g1w` | `g1w` | none |
| Website | local `vite --mode staging` builds only | Hosting `index-DOGmJNPd.js` = main `d736e4d` | n/a |
| Migration 45 | original | corrected 6DD | **yes (N11)** |
| Migration 46 | original applied | not applied | **yes** |
| Service accounts | dedicated per service | dedicated per service (G05) | none |
