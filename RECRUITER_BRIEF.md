# Brief: build the Recruiter dashboard

You are building one feature into an existing, live product. Read `CLAUDE.md`
and `START_HERE.md` first — they carry the rules you cannot guess.

Work on the branch `work/b`. Do not merge to `main`; someone else reviews and
merges. Commit often, push often.

---

## What already exists

ProofLabAI turns student claims into evidence. Colleges import students, each
student gets one real piece of work a day (a **Lot**), submits it, and explains
it out loud for sixty seconds. Work is scored, students compete in squads, and
the result is a body of evidence.

Three dashboards are built and live: **Student**, **College/TPO**, **Admin**.
The whole college-and-student half of the product runs end to end today.

**The Recruiter dashboard does not exist at all.** That is your job. It is the
last three steps of the product's twenty-one-step flow:

```
   19  recruiters discover candidates, compare evidence,
       shortlist, and may sponsor a task
   20  the student completes the sponsored task
   21  the recruiter reviews and records an outcome
```

## What you are building — four sections, no more

The architecture is explicit: every role gets exactly four navigation entries.
Backend concepts become tabs inside them, never sidebar items.

```
   Home        new candidates · recommended · recent activity
               · sponsored Lot status
   Talent      discovery and filters
   Shortlist   candidates worth acting on, with notes
   Lots        recruiter-created work: create, active, submissions,
               review, decision
```

### Home
Counts and a queue, all clickable. No number without somewhere to go.

### Talent
Filter candidates by role, skills, skill score, activity recency, consistency,
communication score, squad performance, season rank. Opening one shows the
**Proof Profile**.

### Proof Profile — the screen the whole product exists to produce

```
   identity and education      verified / assessed skills
   resume                      certifications with evidence
   projects with evidence      assessment scores
   daily task performance      60-second explanations (playable)
   consistency and recency     streaks
   squad and season record     sponsored-task history
   recommended role fit
```

**The rule that makes this different from a job board: every score opens into
the evidence underneath it.** A recruiter must be able to go from a number to
the actual work. No figure they cannot inspect.

### Shortlist
Save a candidate with a note. Move from shortlist to sponsoring a Lot.

### Lots
Create a task for a specific candidate with instructions and marking criteria.
It appears on that student's Daily Card like any other Lot. The recruiter
reviews the submission beside the rest of the evidence and records an outcome:
continue · reject · another round · internship · job.

Platform scores and recruiter judgement stay separate. Neither overwrites the
other.

---

## The rules — get these wrong and the feature is unusable

### Consent: who is even visible

A student's Profile → Privacy has three settings. Only one of them makes them
discoverable:

```
   "Anyone with the link"   ->  visible to recruiters
   "College only"           ->  invisible
   "Only me"                ->  invisible
```

Check this in the database policy, not only in the query. A recruiter must not
be able to reach a non-consenting student by any route, including by guessing
an id.

### Contact details are not part of discovery

```
   a recruiter sees      name · branch · skills · evidence · scores
                         · squad record · explanations
   a recruiter does NOT  email · phone · roll number
```

Contact details unlock only when the student accepts the shortlist. Build the
accept step: a notification to the student, and a yes/no they control.

### Isolation

```
   recruiter A cannot see recruiter B's shortlist or Lots
   a recruiter cannot open any college's dashboard
   a college cannot read any recruiter table
   a student sees a sponsored Lot as work, not as surveillance
```

### Verification

Anyone may sign up as a recruiter. An unverified recruiter sees the dashboard
but **no candidates** until an admin verifies them. Add that toggle to the
existing Admin dashboard.

---

## Technical ground rules

Read `CLAUDE.md` for the full list. The ones that will bite you:

- **`app_role` is a Postgres enum** — `('student','college_admin','startup','admin')`.
  Adding `'recruiter'` needs `alter type ... add value`, which **cannot run
  inside a transaction block with other statements**. Put it in its own
  migration, alone.
- **Roles are one per user.** `user_roles` is `UNIQUE (user_id)`. A recruiter is
  not also a student.
- **Never run `supabase db push`.** Apply migrations with the Supabase MCP
  `apply_migration`, then save the identical SQL into `supabase/migrations/`
  and commit it.
- **You own the recruiter tables only.** Create new tables freely. Do **not**
  alter `student_profiles`, `squads`, `tasks`, `proof_uploads` or any existing
  table without saying so in the commit message — someone else is working in
  the same live database.
- **`tasks` already has what a sponsored Lot needs.** Look at how the daily Lot
  is created (`create_lot_for`) before inventing a second task system. Reuse
  `tasks` and `proof_uploads`; do not build parallel ones.
- **Regenerate `src/integrations/supabase/types.ts`** after every schema change.
- **`strict: false`** in tsconfig — the typechecker will not catch a missing
  column. Prove things by running them with a real signed-in session against
  the live database.
- **After `revoke all on function … from public, anon, authenticated`, grant it
  back to `service_role` by name** if an edge function calls it. That revoke
  strips service_role too. This has already caused two bugs here.
- **Never push to `origin`.** Push to `prooflaab`.

## Existing things to reuse, not rebuild

```
   public_resume_scorecards   a view of published scorecards
   student_portfolios         is_public, slug — the consent signal
   recruiter_links            an older, unrelated college feature.
                              Do not extend it; it is not this.
   proof_uploads              submissions, AI scores, review status
   voice_explanations         recordings, transcripts, comms scores
   squad_weekly_scores        consistency and squad performance
   student_activity_events    recency
```

## Order of work

```
   1  the role, the workspace tables, the policies      ← do not skip
   2  four sections, real routing, honest empty states
   3  Talent + filters
   4  Proof Profile
   5  Shortlist + the student's accept step
   6  sponsored Lots + review + outcome
   7  recruiter analytics on Home
```

Get (1) right before anything else. Permissions are cheap now and expensive
after real data exists.

## How to know you are done

Prove each with a real signed-in session, not by reading code:

```
   two recruiters exist; A cannot read B's shortlist
   an unverified recruiter sees zero candidates
   a student set to "College only" is unreachable, including by id
   a student set to "Anyone with the link" appears in Talent
   a recruiter cannot open a college dashboard, and vice versa
   contact details stay hidden until the student accepts
   a sponsored Lot appears on the student's Daily Card
   a submission reaches the recruiter and an outcome is recorded
   the four existing dashboards still work untouched
```

Say what you tested and what came back. If something is half-built, say which
half. Do not report done because it compiles.
