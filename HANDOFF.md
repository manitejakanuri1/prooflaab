# ProofLabAI — session handoff

Written 2026-08-08. Everything below is verified against the live database and
the repo, not recalled. If you are a new session picking this up, read this
first and you should not need to ask the owner to re-explain anything.

The owner is **not a developer**. Explain in short, plain English, prefer a
diagram or a table over paragraphs, and do not assume jargon lands.

---

## 1. Where everything is

| Thing | Value |
|---|---|
| Repo (local) | `C:\Users\manit\prooflabai-mvp` |
| Branch | `deploy/prooflaab` |
| Deploy remote | `prooflaab` → `github.com/manitejakanuri1/prooflaab` |
| Other remote | `origin` → `github.com/Yashwanth-pilli/prooflabai-mvp` (upstream, **not** where deploys come from) |
| Live site | `https://prooflaab.vercel.app` (the custom domain `prooflab.ai` did not resolve from this machine — unverified, worth checking in a browser) |
| Supabase project ref | `ajaeneehxlnmnhjtvrgs` |
| Stack | React 18 + TypeScript + Vite + Tailwind + shadcn; Supabase Postgres/Auth/Storage/Edge Functions; hosted on Vercel |

**`tsconfig.app.json` has `strict: false`.** Type errors that would be caught in
a strict project are not caught here. Do not rely on the typechecker alone.

### Deploying

```bash
# push code (Vercel builds from prooflaab/main automatically)
git push prooflaab deploy/prooflaab:main

# edge functions
npx supabase functions deploy <name> --project-ref ajaeneehxlnmnhjtvrgs

# database — use the Supabase MCP apply_migration tool, then ALWAYS save the
# same SQL into supabase/migrations/<version>_<name>.sql and commit it.
```

**Verify a deploy landed** by comparing the built asset hash to the live one:

```bash
npm run build
grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html      # local
curl -sL https://prooflaab.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

Vercel takes a few minutes. Poll rather than assuming.

**`claude plugin marketplace add` is blocked by the permission classifier** in
this environment. If a plugin needs installing, give the owner the `/plugin`
slash commands to type themselves.

---

## 2. Current state, measured

```
tables in public          59
SECURITY DEFINER fns      77   (8 callable by anon — all intentional)
RLS policies             173
auth users                 3   (1 admin, 2 students)
student profiles           2
```

Working tree clean. Every migration applied to the live database has a matching
file in `supabase/migrations/`. Last commit `d6bcb26`.

---

## 3. What was done today

Nine commits, all pushed and live.

| Commit | What |
|---|---|
| `722c038` `88baad3` | Roadmap redesigned as a Candy-Crush-style vertical level map on a nebula/space background |
| `25f09d9` | Database security lockdown + scale work |
| `6b2d0f5` | Four notification tables merged into one |
| `ea9e954` | Contact details split out of `student_profiles` |
| `68a75fe` | Closed two functions the previous change left open |
| `96db077` | Deleted 3,440 lines and 15 packages nothing used |
| `6c84956` | Shared the identical half of the two assign-tasks screens |
| `d6bcb26` | **Hotfix** — no student profile could be created (see §5) |

### 3.1 Security

- `llm_usage_by_student` was a view running as its owner, so RLS was skipped
  entirely. It joins every student's email to their AI spend. Now
  `security_invoker = on`.
- **67** SECURITY DEFINER functions were callable by `anon` and 74 by any
  signed-in account, including 34 trigger functions and `create_user_with_role`.
  Now 8 and 25, from an allow-list derived from real `.rpc()` calls.
- `create_user_with_role` assigned a role to any user id it was handed. It now
  refuses unless `_user_id = auth.uid()`.
- Any signed-in account could read every student's email. Fixed by moving
  `email`, `resume_url`, `linkedin_url`, `github_url` into a new
  **`student_contact`** table readable only by the student, an admin, or that
  student's own college. Verified: a signed-in stranger gets 0 rows.
- Admin notification policies said "their own" but only checked "is an admin" —
  every admin could read and delete every other admin's inbox.

### 3.2 Scale

- 25 foreign keys had no index. All indexed now.
- 164 RLS policies called `auth.uid()` per row. Wrapped as `(SELECT auth.uid())`
  so Postgres evaluates it once per statement (InitPlan).
- Dropped a duplicate constraint on `task_assignments`.

### 3.3 Correctness bugs found and fixed

- **Six trigger pairs were firing twice.** Every like, comment, follow, new
  post, task assignment and review created *two* notifications. In each pair one
  version was also wrong — the like/comment duplicates wrote a
  `student_profiles.id` into a column holding auth user ids, so those went
  nowhere.
- `get_feed_posts` and `get_user_follow_counts` read `follows`, a table nothing
  has ever written to. They read `user_follows` now.
- The followers dialog read `follows` too, and leaked every follower's email.
- Signup wrote each student into **two** tables; `students` held a second copy of
  name and email that nothing read back. Five code paths did it. All removed.
- Three places wrote notifications from the browser with no INSERT policy, so
  they silently did nothing. They go through `admin_notify_student()` and
  `notify_all_admins()` now, both of which check `is_admin()`.

### 3.4 Cleanup

- 10 dead tables dropped: 8 August backup snapshots still holding deleted
  students' emails and resume links, plus `students` and `follows`.
- 17 unused shadcn UI files, `UserManagement.tsx`, `useStudentPackProgress`,
  `audioToWav` — all unreferenced.
- 15 npm packages removed (56 → 41).
- `getInitials` was declared privately in 12 components; now one export from
  `src/lib/utils.ts` and it no longer crashes on a blank name.
- Student filtering and the four assign-task form drafts extracted to
  `src/lib/studentFilters.ts` and
  `src/components/dashboard/assignTasks/useTaskForms.ts`.

**`admin_users` is NOT junk** — an earlier pass wrongly listed it as dead.
`SystemSettings.tsx` reads and writes it. Leave it.

---

## 4. Migrations applied today

All fifteen are saved in `supabase/migrations/`:

```
20260808065250  index_foreign_keys_for_scale
20260808065326  rls_evaluate_auth_once_per_query
20260808065446  drop_duplicate_task_assignment_constraint
20260808070836  lock_down_function_execution              (see §5 — a no-op)
20260808070902  secure_view_and_role_assignment
20260808071010  restrict_contact_columns_from_anon
20260808071503  revoke_public_execute_on_definer_functions
20260808095011  fix_follow_functions_to_read_user_follows
20260808095033  drop_dead_tables_students_follows_and_backups
20260808095415  unify_notifications_into_one_table
20260808095626  repoint_notification_writers_and_drop_duplicate_triggers
20260808102950  split_contact_details_out_of_student_profiles
20260808103100  let_admins_manage_student_contact_rows
20260808104327  revoke_anon_execute_on_new_definer_functions
20260808123928  stop_validating_email_column_that_moved_to_student_contact
```

---

## 5. Landmines — read this before touching the database

Three real mistakes were made today. Do not repeat them.

### 5.1 `REVOKE ... FROM anon` is a no-op when the grant is on PUBLIC

Postgres grants EXECUTE on every new function to `PUBLIC`. Revoking from `anon`
changes nothing — the ACL shows `=X/postgres`. The first lockdown migration
reported success and changed nothing at all.

**Additionally**, this project has default privileges that grant EXECUTE on new
functions to `anon`, `authenticated` and `service_role` *by name*. So a
`REVOKE ... FROM PUBLIC` does not remove those either.

`20260808104327` handles both: it revokes from `PUBLIC, anon, authenticated` in
a sweep, re-grants an allow-list, and turns off the default privilege. **Re-run
that sweep after adding any SECURITY DEFINER function.**

### 5.2 Dropping a column does not check triggers

This is what broke the resume upload. `20260808102950` dropped
`student_profiles.email`, but `validate_student_profile()` still read
`NEW.email`. Postgres does **not** validate a trigger body against dropped
columns at migration time — it fails on the next INSERT with
`record "new" has no field "email"`.

Result: every student who signed up afterwards got an auth account and no
profile row, and `resume-parser` answered `404 Student profile not found`.
The build passed, the typecheck passed, the security advisors passed. It only
surfaced when a real person tried to upload a resume.

**Before dropping a column, grep every trigger function and view for it:**

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosrc ~* '(NEW|OLD)\.<column>';
```

Swept after the fix — nothing else references the four dropped columns.

### 5.3 The two id spaces

This has caused several bugs and will cause more.

```
student_profiles.id   ← a student profile id
auth.users.id         ← an auth user id
```

- `user_follows`, `notifications`, `student_contact` owner, `social` actors →
  **auth user id**
- `proof_posts.student_id`, `tasks.student_id`, `proof_uploads.student_id`,
  `xp_logs.student_id` → **student profile id**

Mixing them does not error. It silently matches nothing. Every "notification
addressed to nobody" bug found today was this.

---

## 6. Parked, with a decision waiting

### The two assign-tasks screens

`src/components/dashboard/admin/AdminAssignTasks.tsx` (1,660 lines) and
`src/components/dashboard/college/AssignTasks.tsx` (1,473 lines) were built by
copying one into the other. The identical half is now shared. The rest is
**deliberately not merged** — the owner said "don't do anything, this part
later".

They differ in four ways, and each is a product decision, not a copy-paste:

| | Admin | College |
|---|---|---|
| Public/private control | dropdown | switch |
| Branch list in the AI tab | fixed list of six | branches its students actually have |
| Title validation | 3–200 characters | non-empty only |
| How the task is saved | via the `assign_tasks` edge function | direct insert + its own audit log |

Four options were put to the owner and none chosen yet:
1. one file, keep both behaviours behind a `scope` prop (zero risk)
2. best of each
3. admin's version wins
4. college's version wins

### Student dashboard cleanup — planned, not started

Audited, nothing done. 19 routes, 18 files, 5,612 lines.

- **Delete:** `StudentJobOpportunitiesPage` (240 lines, `job_opportunities` has 0
  rows and nothing writes to it) and `StudentLearningResourcesPage` (277 lines,
  same, and unreachable from the sidebar).
- **Delete:** `StudentResumeCheckPage` — 11 lines that render one other
  component.
- **Merge:** Applications into Assigned Tasks as a status filter. An accepted
  application writes a `task_assignments` row, so both screens already show the
  same task under two names.
- **Fix:** Feed, Portfolio and Progress have no sidebar entry — and **Feed is the
  default landing screen**, so a student lands somewhere they cannot navigate
  back to. All three are reachable only from four small buttons at the bottom of
  the overview.

Net: 19 routes → 15, and 4 dead-end sidebar buttons removed.

### Landing page redesign — demo only

The owner liked `https://archive-devin-ai.lusion.co/` and asked for that look. A
standalone demo was built with ProofLabAI's own content — **nothing was applied
to the codebase**.

Demo: `https://claude.ai/code/artifact/6649050d-f789-4eac-ad08-397e4b3119b7`
Source: the scratchpad, not the repo.

Their real design tokens, taken from their CSS:

```
#10131c  ground      #2622f7  indigo (primary)
#f6f6f6  ink         #4991e5 → #39bdd6 → #3bd4cb  blue → cyan → teal
#a7a6a6  dim         #ec5d40  ember
IBM Plex Mono, weight 400 only — hierarchy from size and colour, never weight
A full-page WebGL canvas behind everything (theirs is Three.js, 52 shaders)
```

Not yet decided: whether it goes on the landing page only, all public pages, or
nowhere. Note that dark navy + monospace is a poor fit for the dense data tables
in the dashboards.

---

## 7. Owner-only, still outstanding

These cannot be done from a session:

1. **Supabase dashboard → Auth → enable leaked-password protection.** It is the
   only remaining security advisor warning that is not intentional.
2. **Reset the admin password.** `ProofLab@Admin2026` was exposed in a chat
   transcript.
3. **Set a `GITHUB_PAT` edge-function secret** (scopes `repo` + `read:user`) —
   needed by the GitHub commit-history verification.
4. **Check `prooflab.ai` resolves in a browser.** It did not respond from this
   machine; `prooflaab.vercel.app` serves the current build correctly.

---

## 8. How the owner likes to work

- **Show a standalone HTML preview before putting UI into the codebase.** This
  was asked for explicitly and has held all session.
- **Plan and diagram first** for anything large. "frist me plan and diagram" —
  do not start executing a big change unprompted.
- **Security is the top priority** when trading off against anything else.
- Short answers. Diagrams and tables over prose. Plain English, no jargon.
- Confirm before irreversible actions (dropping tables, deleting data). The
  owner does answer these quickly, so ask rather than guess.

Two Claude Code plugins are installed at user scope: **caveman** (terse prose)
and **ponytail** (build less). Ponytail is the one that matters — it enforces a
ladder: does this need to exist → is it already in the codebase → stdlib →
native platform → existing dependency → one line → minimum code.

---

## 9. First thing to check in a new session

```bash
cd C:/Users/manit/prooflabai-mvp
git status --short            # expect clean
git log --oneline -1          # expect d6bcb26 or later
npx tsc -b --noEmit           # expect silence
npm run build                 # expect success
```

Then ask the owner which of §6 they want to pick up.
