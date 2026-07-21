# ProofLabAI — Full Project Understanding Document

*A plain-English walkthrough of what this project is, every feature inside it, why each feature exists, and how it helps.*

---

## 1. What Is This Project, In One Paragraph

**ProofLabAI** is a website where college students do real technical tasks, upload the work they did (usually a GitHub link), and the system **automatically checks whether the student actually did that work themselves** — or whether they copied it, or got an AI to write it for them.

If the work passes the check, it gets a **"Verified" stamp**. Those verified pieces of work build up into a **public portfolio** the student can show to recruiters.

So there are three problems it solves at once:

| Who | Their problem | What ProofLab gives them |
|---|---|---|
| **Student** | "My resume says I know React, but nobody believes me." | A public portfolio of work that a machine has verified as genuinely theirs. |
| **College** | "We have 500 students. We can't check each project by hand." | A dashboard that assigns work to all students and auto-grades authenticity. |
| **Startup/Recruiter** | "Every resume looks the same and half are fake." | A filtered list of students whose skills are backed by verified proof. |

The tagline used on the landing page: *"India's first AI-powered proof-of-work platform."*

---

## 2. The Core Idea: "Cognitive Integrity Score"

This is the heart of the whole product, so it's worth understanding first. Everything else is built around it.

When a student submits work, the system does **not** just ask "is this code good?" It asks a harder question: **"Does this student actually understand the code they submitted?"**

To answer that, it runs three separate investigations:

### Check 1 — Commit Authenticity (35% of the score)
The system reads the **GitHub commit history** of the submitted repo.

- **What it looks for:** How many commits are there? Over what time period? How big was the biggest single commit? How many different people contributed?
- **The logic:** Real work looks like *many small commits over days or weeks*. Copied work looks like *one giant commit that dumps 3,000 lines at once*.
- **The penalty:** If any single commit changed more than 1,000 lines, the score is docked 20 points. That's the classic "I pasted an entire project in one go" signature.
- **The reward:** More commits = higher score, capped at 20 commits being a perfect score.

### Check 2 — AI Authorship Risk (25% of the score)
The system sends the code to **Google Gemini** and asks it: *"How likely is it that an AI wrote this?"*

- **What it looks for:** Writing patterns typical of ChatGPT/Copilot output — over-uniform comments, textbook variable naming, suspiciously complete error handling for a beginner project.
- **How it scores:** Gemini returns an "AI risk" number from 0–100. The system flips it: `authorship_score = 100 − ai_risk`. So low AI risk = high score.
- **Why it matters:** This is the single biggest new problem in student assessment. Every student now has access to an AI that can write the whole project. This check exists specifically because of that.

### Check 3 — Conceptual Understanding (40% of the score — the biggest weight)
This is the cleverest part and the thing that makes the product hard to cheat.

- The system **reads the student's actual submitted repository**, then uses Gemini to generate **multiple-choice questions about that specific code**. Not generic questions — questions grounded in the real files the student submitted.
- The student then takes a **quick-fire quiz** (30 seconds per question) right after submitting.
- Each answer is graded on **correctness (70% weight)**, plus a bonus for referencing real details from their own repo, **minus a 20-point penalty if the answer itself looks AI-generated**.
- **Why this is the killer feature:** You can fake a GitHub repo. You can hide AI-written code. But if you didn't write it, **you cannot answer questions about it under a 30-second timer.** This is why it carries the largest weight (40%).

### Putting It Together

```
Cognitive Integrity Score (CIS)
  = (Commit Authenticity × 0.35)
  + (AI Authorship Score × 0.25)
  + (Conceptual Understanding × 0.40)
  + ethical bonuses
```

**The "ethical bonuses"** — a deliberately human touch:
- **+5 points** if the student ticked the *Integrity Declaration* ("I confirm this is my own work"). Rewards honesty.
- **+3 points** if the student requested a *Reflection* (voluntarily explained their process). Rewards a learning mindset.

**The verdict thresholds:**

| Score | Verdict | What happens |
|---|---|---|
| **60–100** | ✅ Verified | Auto-approved. Trust score +3. Gets the public "Verified" badge. |
| **40–59** | ⚠️ Needs Review | Flagged for a human (college admin) to look at manually. Trust +1. |
| **0–39** | ❌ Failed | Rejected. Admin is notified. Trust +0. |

The system also writes a **plain-English summary** explaining *why*, e.g. *"Moderate cognitive integrity (48/100). Concerns: High AI-generated content likelihood, Weak conceptual understanding."* The student sees this — so it teaches, it doesn't just punish.

### There's also a plagiarism check (MOSS)
Separately, the code can be run through **MOSS** (Stanford's Measure of Software Similarity — the standard academic plagiarism tool for code). If similarity is above 60%, trust score is docked 15 points.

---

## 3. Who Uses It — The Four Roles

The app has exactly four kinds of users, defined in the database as `app_role`:

```
'student' | 'college_admin' | 'startup' | 'admin'
```

Each role gets a **completely different dashboard**. They log in through separate doors (`/student/login`, `/college/login`, `/startup/login`, `/admin/login`) and are locked into their own area by a route guard called `RoleBasedProtectedRoute`. A student physically cannot open the college dashboard URL.

---

## 4. THE STUDENT DASHBOARD (Detailed)

This is the biggest part of the app. The sidebar was recently reorganised from 13 flat items down to **7 items with grouped submenus** to reduce clutter.

### 4.1 My Dashboard (the home screen)

Four stat cards at the top:

| Card | What it shows | Why it exists |
|---|---|---|
| **Work Time This Week** | Hours logged working on tasks | Shows effort, not just output. Builds a habit. |
| **This Month's XP** | Points earned this month | Short-term motivation — a fresh number every month so you never feel "too far behind". |
| **Trust Score** | 0–100 authenticity rating | The single most important number. This is your reputation. |
| **Leaderboard Rank** | Your position vs other students | Social competition. Peer pressure as a motivator. |

Below that: recent activity, notifications, and quick actions.

**Why this design:** A student opening the app should instantly know *"am I doing enough, and is my reputation healthy?"* — those are the only two questions that matter.

### 4.2 Tasks (grouped menu)

**a) Assigned Tasks** — work pushed to the student by their college or a startup.
- *Purpose:* The college controls the curriculum. Students don't have to figure out what to build.

**b) My Created Tasks** — tasks the student invented for themselves.
- *Purpose:* Self-directed learners aren't blocked by what the college assigns. You can prove skills your college doesn't teach.

**c) Create a Task** — with two modes:
- **AI Task Generator** — describe roughly what you want to learn, and Gemini writes a full task brief with deliverables. Uses the `generate-task-ai` function.
- **Manual Task Form** — write it yourself.
- *Purpose:* Removes the "blank page" problem. Most students don't know what a well-scoped project looks like; the AI shows them.
- *Cost control:* This costs **credits** (see §4.9).

**d) Task Packs** — a curated *series* of related tasks bundled together (e.g. "Full-Stack Fundamentals — 8 tasks").
- Each pack has a **difficulty level**, an **XP reward**, and a **badge reward**.
- Progress is tracked per student (`student_pack_progress`).
- When you finish all tasks in a pack, `award_pack_completion` fires and you get a **celebration modal with confetti** plus your XP and badge.
- *Purpose:* Single tasks are scattered. Packs give a **learning path** with a beginning, middle, and an end. The completion celebration exists because finishing things feels good and makes people come back.

**e) Pack Leaderboard** — rankings within a specific pack.
- *Purpose:* Competition scoped to your cohort. Being 3rd out of 40 in your pack is far more motivating than being 800th overall.

### 4.3 Opportunities (grouped menu)

**a) Startup Tasks** — real paid/unpaid tasks posted by actual startups on the platform.
- *Purpose:* This is the bridge from "practice work" to "real work". A student's proof becomes a real deliverable for a real company.

**b) Job Openings** — job posts from startups.
- *Purpose:* The end goal. The whole point of building a verified portfolio is getting hired.

### 4.4 Applications
Track every task/job you applied for and its status.
- *Purpose:* Students apply to many things and lose track. One place to see "did they respond yet?"

### 4.5 My Uploads
Every proof you've ever submitted, with its current verification status and score.
- *Purpose:* Your permanent record. Also where you'd go to check on something stuck in "Under Review".

### 4.6 The Social Feed (a LinkedIn-like layer)

This is a substantial feature set built around `proof_posts`:

- **Feed of posts** — verified work shared publicly by students, with an emoji code, title, description, skills tags, and a **Verified badge** if the underlying proof passed.
- **Post types:**
  - *Verified Post* — built from a proof that passed verification (`VerifiedProofSelectorModal` lets you pick which one).
  - *External Project Post* — work done outside the platform (unverified, clearly marked).
- **Likes, comments, shares, view counts** — full engagement tracking (`post_likes`, `post_comments`, `post_engagements`).
- **Follow / Followers / Following** — students follow each other (`user_follows`).
- **Suggested Students** — the `get_follow_recommendations` function ranks who to follow using a score built from **trust score, total XP, and follower count**. Not random — it surfaces people who actually do good work.
- **Onboarding Follow Suggestions** — new users are immediately given people to follow so the feed isn't empty on day one.

**Why this exists:** A portfolio nobody looks at is worthless. The feed makes verified work *visible* — to peers, to juniors, to recruiters browsing. It turns a static résumé into an ongoing public record. And crucially, **only verified work gets the badge**, so the social layer reinforces the integrity system rather than undermining it.

### 4.7 Portfolio (`/portfolio/:slug`)
A **public web page** for each student — no login needed to view it.
- Contains: bio, skills, achievements, and their verified projects.
- Has a `is_public` toggle and a custom URL slug.
- *Purpose:* This is the thing you paste into a job application. It's the product's actual output. Everything else in the app exists to fill this page with credible content.

### 4.8 Notifications & Settings
- Real-time notifications for: proof verified, XP earned, task assigned, someone followed you, quiz results ready.
- Settings: profile photo, GitHub/LinkedIn links, resume, visibility controls, career goals, key interests, AI personalization toggle.

### 4.9 The Credits System
Every student gets **10 credits per day** (premium accounts get 999). Credits are consumed by expensive AI operations like AI task generation. They reset automatically at midnight (handled by the `reset-daily-credits` function and a client-side date check).

- *Purpose:* Gemini API calls cost real money. Without a cap, one student could run up a huge bill. This also creates a natural upgrade path for a paid tier.

### 4.10 Appeals
If a student believes verification wrongly rejected their work, they can file an **appeal** (`proof_appeals`, via `AppealSubmissionModal`).
- *Purpose:* **Essential fairness mechanism.** No automated judging system is trustworthy without a route to a human. The AI will sometimes be wrong; this is the escape hatch.

---

## 5. THE COLLEGE DASHBOARD (Detailed)

Built for a placement officer or department head managing hundreds of students at once.

### 5.1 My Dashboard (overview)
Four stat cards:
- **Total Students Onboarded**
- **Tasks Assigned**
- **Proofs Received**
- **Verified Proofs**

*Why these four:* They form a funnel. Onboarded → Assigned → Submitted → Verified. Seeing where the number drops tells you exactly where students are getting stuck.

### 5.2 Students
The full student roster with search and filters.
- Click any student → **Student Profile Modal** showing their trust score, XP, submissions, and history.
- **Bulk CSV upload** — upload a spreadsheet of students and the system creates all their accounts at once (via the `create-student-users` function). There's a downloadable CSV template.
- *Purpose:* No college is going to register 500 students one by one. Bulk import is what makes adoption realistic.

### 5.3 Assign Tasks
Push a specific task to specific students or a whole batch.
- *Purpose:* The college drives the curriculum.

### 5.4 Assign Task Pack
Push an entire multi-task pack to a whole batch at once (`assign_pack_to_batch`, tracked in `pack_batch_assignments`).
- *Purpose:* "Assign the Full-Stack pack to all of CSE 3rd year" — one click instead of 200.

### 5.5 Pack Analytics
Per-pack breakdown: how many students started, how many finished, average scores, where people drop off.
- *Purpose:* Tells the college **whether the curriculum is working**. If 80% abandon a pack at task 4, that task is badly designed.

### 5.6 Uploaded Proofs
Every submission from their students, with AI verdict, scores, and status. The college admin can approve/reject manually.
- *Purpose:* Human oversight over the automated system. The AI recommends; the college decides.

### 5.7 Trust Scores
A ranked view of every student's trust score.
- *Purpose:* Identify both the top performers (to recommend to recruiters) and the students who are struggling or repeatedly flagged (to intervene early).

### 5.8 Verification Trends
Charts showing verification outcomes over time.
- *Purpose:* Spot patterns. A sudden spike in AI-flagged submissions across a batch is a signal the college needs to act on.

### 5.9 Verification Settings ⭐
This is an important and thoughtful feature. Each college can set **its own thresholds**:

| Setting | What it controls |
|---|---|
| `auto_approve_threshold` | Score above which proofs pass with no human review |
| `min_authenticity_score` | Minimum acceptable commit-history score |
| `min_ai_likelihood` | How much AI involvement is tolerated |
| `min_conceptual_score` | Minimum quiz performance required |
| `min_trust_score` | Overall floor |

*Why this matters:* A 1st-year intro course and a final-year capstone should not be judged identically. Strictness is a policy decision, and this hands that decision to the college instead of hard-coding it.

### 5.10 Recruiter Links ⭐
The college generates a **shareable link** for recruiters (`/recruiter/:linkId`). Each link has:
- **Filters** (e.g. only students with trust score > 70, only Computer Science, only specific skills)
- An **expiry date**
- **View tracking** (`recruiter_link_views`)

A recruiter opening the link sees a filtered, verified student list — **no account needed**. They can express interest (`recruiter_interests`) or contact a student directly (`ContactStudentModal`).

*Why this is arguably the most commercially valuable feature:* It's the college's actual job — placing students. The college sends one link to a hiring manager, and that manager sees pre-vetted candidates with machine-verified skills. No friction, no signup, and the college can prove the link was viewed.

### 5.11 Profile, Settings, Notifications
Standard institution profile management and alerts.

---

## 6. THE STARTUP DASHBOARD

Simpler and more focused — startups want talent, not administration.

| Page | What it does | Purpose |
|---|---|---|
| **Dashboard Home** | Activity summary and stats | Quick pulse check |
| **Post Task** | Publish a real task for students | Get real work done cheaply while evaluating candidates |
| **View Posted Tasks** | Manage existing tasks, edit them | Housekeeping |
| **View Applications** | See who applied, with real applicant counts | Pick who to work with |
| **Student Submissions** | Review completed work with its verification scores | **See both the work AND the proof it's genuine** |
| **Post A Job** | Publish an actual job opening | Convert a proven student into a hire |
| **Settings** | Company profile | — |

There's also a **Verification Banner** — startups must be verified before they get full access.
- *Purpose:* Stops fake companies from harvesting student data or posting scam "jobs". Protects students.

**The whole startup value proposition:** *"Post a task. Watch students actually do it. Hire the one who did it best — and know for certain they did it themselves."* That is a fundamentally better hiring signal than a résumé or a 45-minute interview.

---

## 7. THE ADMIN DASHBOARD (Platform Owner)

This is you — the person running ProofLabAI.

| Section | What it does |
|---|---|
| **Dashboard Home** | Platform-wide stats: total students, active colleges, active startups, pending proofs, active tasks |
| **Notifications** | System-wide alerts |
| **User Management** | Manage students / startups / colleges — create, edit, suspend |
| **Proof Review & Verification** | Manually review any submission on the platform, override AI verdicts |
| **Task Oversight** | See all tasks everywhere, edit or reassign them |
| **Assign Tasks** | Push tasks directly, bypassing the college |
| **Task Packs** | Create, edit, and publish the curated packs — plus pack analytics |
| **Content Management** | Manage Jobs, Learning Resources, and Announcements shown across the platform |
| **Reports & Analytics** | Platform-wide reporting |
| **Trust & XP Moderation** | Manually adjust a student's trust score or XP (every change is written to `manual_adjustment_log`) |
| **College Oversight** | Monitor college accounts and their activity |
| **Student Oversight** | Deep-dive on individual students |
| **System Settings & Roles** | Platform configuration and role assignment |

*Why Trust & XP Moderation is logged:* If an admin can silently change a trust score, the score means nothing. Every manual adjustment is permanently recorded, so the number stays credible.

---

## 8. SIGNUP, LOGIN AND ONBOARDING

### Invite Codes
The platform is **invite-only**. Codes are stored in `invite_codes` with a **role attached**, a **creator**, an **expiry date**, and a **one-time-use flag**.

*Why:* Two reasons. (1) Quality control — you don't want random signups polluting a platform whose entire value is trustworthiness. (2) It ties each new user to a specific college or startup automatically.

### Email Verification
Full email confirmation flow (`email_verifications`, plus `EmailVerificationScreen`, `EmailConfirmationRequired`, `EmailVerificationPrompt`) and an onboarding email (`send-onboarding-email`).

### Rate Limiting
`auth_rate_limits` and `signup_rate_limits` tables with a `check_rate_limit` function.
- *Purpose:* Blocks brute-force password guessing and bulk fake-account creation.

### Role-Specific Onboarding Wizards
Three separate multi-step wizards — `StudentWizard`, `CollegeMultiStepWizard`, `StartupMultiStepWizard`.
- *Purpose:* A student needs to give their branch, batch, GitHub URL, and interests. A startup needs a company profile. Asking everyone the same questions would be a bad experience. Each role gets only what's relevant.

---

## 9. THE TECHNICAL STACK (In Plain Terms)

### Frontend
| Piece | What it is |
|---|---|
| **React 18 + TypeScript** | The UI framework |
| **Vite** | The build tool (fast) |
| **Tailwind CSS + shadcn/ui** | Styling and ~45 pre-built components (dialogs, tables, charts…) |
| **React Router v6** | Page navigation |
| **TanStack Query** | Data fetching and caching — 5-minute stale time, 30-minute cache, so the app doesn't hammer the database |
| **Recharts** | All the graphs |
| **next-themes** | Dark/light mode |
| **canvas-confetti** | The pack-completion celebration |

**Performance work already done:** Every route except the landing page and login is **lazy-loaded**. Only the code you actually need is downloaded. There's also a global `ErrorBoundary` so one broken component doesn't white-screen the whole app.

### Backend — Supabase (Postgres)
- **~55 database tables**
- **~280 migration files** — this project has been iterated on heavily over roughly a year
- **Row Level Security (RLS)** on tables — the database itself enforces that a student can only read their own data, a college only sees its own students. Multiple commits in the history are specifically about hardening these policies.
- **~40 database functions** for complex operations (`get_feed_posts`, `get_leaderboard`, `assign_pack_to_batch`, `validate_invite_code_secure`, etc.)
- **Realtime subscriptions** for live notifications

### Backend — Edge Functions (14 serverless functions)

| Function | Job |
|---|---|
| `github-check` | Pulls and analyses commit history from the GitHub API |
| `ai-authorship` | Asks Gemini how likely the code is AI-written |
| `question-generator` | Generates quiz questions from the student's actual repo (Gemini 2.5 Flash Lite) |
| `submit-conceptual-answers` | Receives the student's quiz answers |
| `response-evaluator` | Grades each answer, detects AI-written answers |
| `trust-compute` | Combines all three checks into the final Cognitive Integrity Score |
| `verify-proof` | Orchestrates the older/simpler verification path |
| `moss-check` | Plagiarism similarity check |
| `generate-task-ai` | AI task generation for students |
| `assign_tasks` | Bulk task assignment |
| `create-student-users` | Bulk student account creation from CSV |
| `send-onboarding-email` | Welcome emails |
| `reset-daily-credits` | Nightly credit reset |
| `test-github-connection` | Diagnostic helper |

**Security note:** Every one of these functions authenticates the caller and checks ownership — a student can only run verification on **their own** proof; only admins and college admins can run it on others. There's also a webhook-secret path for internal/scheduled calls. Several commits in the history (`Hardened edge function auth`, `Fixed 3 auth/security issues`) were specifically about tightening this.

### Audit Logging
`audit_logs`, `activity_logs`, `proof_public_audit`, and `manual_adjustment_log` record what happened and who did it.
- *Purpose:* If a trust score is ever disputed — by a student, a college, or a recruiter — you can reconstruct exactly how it was calculated and whether anyone touched it.

### Deployment
Vercel, originally scaffolded with Lovable, Supabase project `zlfjxcwltqtajnczfjjp`.

---

## 10. THE FULL JOURNEY — How It All Connects

Here is the complete life of one piece of work:

```
1.  College admin bulk-uploads 200 students from a CSV
        ↓
2.  Students get invite codes, sign up, verify email, complete onboarding wizard
        ↓
3.  College assigns "Full-Stack Fundamentals" task pack to CSE 3rd year
        ↓
4.  Student opens task 1, builds it, pushes to GitHub over 2 weeks
        ↓
5.  Student submits the repo URL as a proof, and ticks the Integrity Declaration
        ↓
6.  ── AUTOMATIC VERIFICATION FIRES ──
        a. github-check    → reads commit history        → commit authenticity score
        b. ai-authorship   → Gemini reads the code       → AI risk score
        c. question-gen    → Gemini writes 3 MCQs about THIS repo
        ↓
7.  Quiz auto-opens for the student. 30 seconds per question.
        ↓
8.  response-evaluator grades the answers (and checks if the ANSWERS were AI-written)
        ↓
9.  trust-compute combines everything:
        35% commits + 25% AI-authorship + 40% quiz + honesty bonuses
        = Cognitive Integrity Score
        ↓
10. Verdict:
        ≥60 → ✅ Verified   (trust +3, badge awarded, XP granted)
        40-59 → ⚠️ Needs Review (college admin looks at it manually)
        <40 → ❌ Failed      (student sees WHY, and can appeal)
        ↓
11. Student's trust score and XP update. Leaderboard rank shifts.
        ↓
12. Student shares the verified work as a post → appears in the feed with a Verified badge
        ↓
13. The verified project lands on their public portfolio page
        ↓
14. College generates a recruiter link filtered to "trust score > 70, CSE, React"
        ↓
15. Startup opens the link (no signup needed), browses verified students,
        expresses interest, contacts the student
        ↓
16. Startup posts a real task → student does it → startup posts a job → student is hired
```

**That last line is the whole point.** Every feature in this project exists to move a student one step further along that chain.

---

## 11. Why Each Major Design Decision Was Made

| Decision | The reasoning |
|---|---|
| **Conceptual quiz weighted highest (40%)** | Code can be faked; understanding cannot. This is the hardest check to cheat. |
| **Quiz questions generated from the student's own repo** | Generic questions could be answered by anyone. Repo-specific questions only your own author can answer. |
| **30-second timer per question** | Long enough to think, too short to paste into ChatGPT and wait for a reply. |
| **Bonus points for the honesty declaration** | Frames the system as *encouraging integrity*, not just *catching cheaters*. Better psychology, better outcomes. |
| **Per-college verification thresholds** | A 1st-year and a final-year project shouldn't be graded the same way. Policy belongs to the college. |
| **An appeals process** | An automated judge without a human appeal route is not trustworthy. |
| **Credits system** | AI calls cost money. Caps spend and creates a paid-tier path. |
| **Recruiter links with no signup required** | Every signup step loses recruiters. Zero friction was the right call. |
| **Invite-only signup** | The platform's entire value is trust. Open signup would dilute it immediately. |
| **RLS at the database level** | Even if a frontend bug leaks a query, the database refuses to return other students' data. Defence in depth. |
| **Everything logged to audit tables** | A trust score you can't audit is a trust score nobody will believe. |
| **Task Packs instead of loose tasks** | Learning needs a path with an ending. Packs give structure and a sense of completion. |
| **A social feed on top** | A portfolio nobody sees is worthless. Visibility is what converts proof into opportunity. |

---

## 12. Recent Work (from the git history)

The last ~20 commits show what was worked on most recently:

- **Sidebar simplification** — student sidebar reduced from 13 flat items to 7 with grouped submenus
- **Quiz improvements** — verdict now shown inside quiz results; quiz auto-opens right after proof submission; timer increased from 15s to 30s per question; questions grounded in real repository code; results screen is reviewable so students learn from mistakes
- **Bug fixes** — trust_scores write path fixed, duplicated realtime channels fixed, tasks no longer stuck in "In Progress" after submission, two dead buttons wired up
- **Security hardening** — edge function auth tightened, three auth/security issues fixed, RLS hardened on colleges and profiles
- **Cleanup** — ~42 unreferenced files and ~4,900 lines of dead code removed; dead email functions removed; `.env` stopped being tracked in git; PII redacted from old data migrations

The project has **984 commits** total — this is a mature, heavily-iterated codebase, not a prototype.

---

## 13. Quick Reference — Every Feature At A Glance

**Student:** dashboard stats (work time, XP, trust score, rank) · assigned tasks · self-created tasks · AI task generator · task packs with XP & badge rewards · pack completion celebration · pack leaderboard · startup task opportunities · job openings · applications tracker · uploads history · proof submission with integrity declaration · auto-firing conceptual quiz · reviewable quiz results · appeals · social feed · verified & external posts · likes/comments/shares · follow system · suggested students · public portfolio page · notifications · settings · daily credits

**College:** overview funnel stats · student roster · bulk CSV student import · student profile modal · assign tasks · assign task packs to batches · pack analytics · uploaded proofs review · trust score rankings · verification trend charts · **per-college verification thresholds** · **filtered recruiter links with expiry & view tracking** · recruiter interest tracking · college profile · notifications · settings

**Startup:** dashboard home · post task · manage posted tasks · view applications with real applicant counts · review student submissions with verification scores · post jobs · company verification banner · settings

**Admin:** platform stats · notifications · user management (students/startups/colleges) · proof review & override · task oversight · direct task assignment · task pack creation & editing · pack analytics · content management (jobs, resources, announcements) · reports & analytics · trust & XP moderation with audit logging · college oversight · student oversight · system settings & roles

**Platform-wide:** invite-code signup · email verification · rate limiting · role-based route guards · row-level security · audit logging · dark/light theme · lazy-loaded routes · error boundary · real-time notifications

---

*Document generated from a full source analysis of `C:\Users\manit\prooflabai-mvp` — 260+ source files, 55 database tables, 14 edge functions, 984 commits.*
