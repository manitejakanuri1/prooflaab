# ProofLabAI — The Complete Project Book

*A full explanation of this project, written so that a curious 11-year-old, a
beginner programmer, and an experienced developer can all read the same
document and each get what they need.*

Written 8 September 2026, from the code at commit `077fe5a`.

---

## How to read this book

There are thirteen chapters. You do not have to read them in order.

| If you are… | Read |
| --- | --- |
| Curious what this thing is | Chapters 1 and 2 |
| A student learning to code | Chapters 3, 4, 6, then dip into 5 |
| Setting it up on your computer | Chapter 7 |
| Going to use it, not build it | Chapter 8 |
| Going to change the code | Chapters 5, 9, 10 |
| Lost in a word you don't know | Chapter 11 |

Whenever a technical word appears for the first time, it is explained right
there in brackets. Chapter 11 collects them all in one place.

---

# 1. Project overview

## The one-sentence version

**ProofLabAI is a website that gives every college student one real piece of
work each day, checks whether they truly did it themselves, and turns months of
that work into proof a company can trust when hiring them.**

## The problem it solves

Imagine you are finishing college and applying for your first job. You write on
your CV: *"I know Python. I built a website. I understand databases."*

Now imagine you are the company reading a thousand of those CVs. Every single
one says the same thing. You have no way to tell who is telling the truth.

That is the problem. Not that students are lying — most are not — but that
**there is no difference on paper between a student who really built something
and a student who copied it.** So companies fall back on college names and exam
marks, which measure something else entirely.

ProofLabAI's answer is simple: **stop asking students to describe their skills,
and start collecting evidence of them.** Every day, over months.

## Who uses it

Four kinds of people, each with their own screen:

| Who | What they do here |
| --- | --- |
| **Student** | Gets one task a day, does it, explains it out loud |
| **College (TPO)** | Uploads the student list, watches who is progressing and who has gone quiet |
| **Recruiter** | Searches for students, reads their evidence, hires |
| **Administrator** | Runs the platform, approves recruiters, sets the rules |

*TPO means "Training and Placement Officer" — the person at an Indian college
whose job is getting students hired.*

## The technologies, in plain words

| Layer | What we use | What that means |
| --- | --- | --- |
| The screens | **React** | A tool for building websites made of reusable blocks |
| The language | **TypeScript** | JavaScript with spell-check for code |
| The builder | **Vite** | Turns our code into a fast website |
| The look | **Tailwind CSS** | A way of styling things with short labels |
| Storage + login | **Supabase** | A database and login system, rented rather than built |
| The brain | **DeepSeek** | An AI that writes tasks and marks written answers |
| The home | **Vercel** | The company that puts our website on the internet |

There is no separate "backend server" that we run. That is unusual and worth
understanding: normally a website has a second program running somewhere doing
the thinking. Here, most of the thinking happens **inside the database itself**,
and small pieces of code called **edge functions** handle anything that needs to
talk to the AI. Chapter 3 explains why.

---

## The main features

**For the student**

- One real task a day, six days a week. Not a quiz — an actual piece of work.
- Explain your work out loud for sixty seconds. This is the hardest part to fake.
- A ladder of 197 topics across 17 subjects to climb.
- A squad of eleven classmates who compete together each week.
- Six leaderboards and seven awards, so effort gets noticed.
- A resume checker that scores your CV and suggests fixes.
- A proof profile that recruiters can read.

**For the college**

- Upload a spreadsheet of students; accounts are created and invitations sent.
- Squads are formed automatically, balanced so no one team gets all the toppers.
- A twelve-week season that runs itself: league, championship, final.
- See at a glance who is working and who has gone silent.
- Post real job descriptions so the daily tasks match real hiring.

**For the recruiter**

- Search students by skill, role, activity and consistency.
- Open a full proof profile with the evidence attached.
- Shortlist people, set them real paid-style work, record who got hired.

**For the administrator**

- Approve recruiters before they can see any student.
- Review flagged work, manage tasks and content, watch system health.

---

## A story: one student's week

Meet Priya. She is in her third year of computer science.

**Monday morning.** Priya opens the website. There is one card on her screen.
It says: *"Build a small program that reads a list of student marks and finds
the top three."* Not a multiple-choice question. A real thing to build.

**Monday evening.** She builds it. She pastes a link to her code. Then the site
asks her to press record and explain, for sixty seconds, what she built and why
she chose that approach. She talks. It records.

**Behind the scenes**, three things happen while she sleeps:

1. Her code link is checked — did it really appear over time, or all at once?
2. Her voice recording is turned into text and read for understanding.
3. Questions are generated *from her own submission* and she is asked them later.

**Tuesday.** A new task appears. Not a random one — the system quietly noticed
she struggled with loops, so today's task leans that way. She never sees that
decision being made.

**Friday.** Her squad — ten classmates plus her — has been collecting points
all week from everyone's daily work. On Sunday night the week locks and the
squad's score is compared with another squad in her section. Her squad wins.

**Three months later.** A recruiter at a company searches for students strong in
Python who have worked steadily for at least ten weeks. Priya appears. The
recruiter opens her profile and sees not a claim but a record: 68 completed
tasks, 68 voice explanations they can actually play, scores that moved upward,
and a streak that never broke for six weeks.

That is the whole product.

---

## What happens behind the scenes, simply

When Priya presses "submit", this is roughly the chain:

```
Priya's browser
      ↓  sends the work
Supabase (the database)
      ↓  wakes up a small program
Edge function
      ↓  asks the AI
DeepSeek
      ↓  sends back a score and feedback
Edge function
      ↓  saves it
Supabase
      ↓  sends it back
Priya's browser shows the result
```

Each arrow is just information moving. Nothing magic.

---

# 2. Project goals and ideas

## The main goal

**Make a student's real ability visible without anyone having to take their word
for it.**

Everything else in the project serves that one sentence. If a feature does not
produce evidence, it does not belong here.

## Secondary goals

**1. Make daily practice something you want to keep doing.**
Doing one task a day for three months is hard. Alone, most people stop. So
students are put into squads of eleven that compete weekly — the same idea as a
cricket league. You keep going partly because ten other people are counting on
you.

**2. Never punish a student for their team losing.**
This one is written into the code as a rule that must never be broken. If a
squad fails to qualify for the championship, **only the competition ends.** The
daily tasks keep coming, the scores keep counting, and every individual award
stays winnable. Losing a league must never stop someone learning.

**3. Give the college something real to look at.**
Colleges currently find out a student has disengaged when it is far too late.
Here it shows up within a week.

**4. Cost almost nothing per student per day.**
AI is expensive if you use it carelessly. A lot of design effort goes into
making sure the AI is only called when nothing cheaper would do.

## What inspired it

Two things are visible in the code and documents.

**Cricket.** The squad system is openly modelled on the IPL — squads of eleven,
a league, a championship, and awards named Orange Cap and Purple Cap. This is
not decoration. It is there because Indian students already understand exactly
how a league works, so nobody needs the rules explained.

**The interview that goes wrong.** The sixty-second spoken explanation exists
because of a specific failure everyone recognises: a candidate whose CV is
excellent and who cannot explain their own project. Talking about your work,
unprepared, for one minute, is remarkably hard to fake — and that is the point.

## The problems it tries to solve

| For | Problem | What this does about it |
| --- | --- | --- |
| Students | "Nobody believes my CV" | Builds a record nobody has to believe on trust |
| Students | "I start learning and stop" | A squad, a streak and a season to keep going |
| Colleges | "We find out too late" | Weekly visibility of every student |
| Recruiters | "Every CV looks identical" | Evidence with the work attached |
| Recruiters | "Interviews are expensive" | Filter on what people did, not what they wrote |

---

# 3. Technology stack

## The screens (frontend)

*Frontend means everything that happens inside your web browser — what you can
see and click.*

**React 18** — A tool for building websites out of reusable blocks called
components. A button, a table, a whole page: each is a block, and blocks fit
inside other blocks. We use it because the same squad table appears on several
screens and we would rather write it once.

**TypeScript** — JavaScript (the language browsers speak) with a spell-checker
for code. If you ask for `student.nmae` instead of `student.name`, it complains
before the website is ever built.

> **Important caution:** this project has that spell-checker turned to a relaxed
> setting (`strict: false`). It catches typing mistakes but it will *not* catch a
> database column that was renamed or deleted. So the code compiling does not
> prove the code works. Screens must actually be clicked.

**Vite** — The builder. Takes 227 files of code and turns them into a small
bundle a browser can download quickly.

**Tailwind CSS** — Styling by short labels. Instead of writing a separate style
file, you write `class="text-sm font-bold"` directly on the thing. Faster to
write and harder to leave dead styles behind.

**shadcn/ui** — A set of ready-made components (buttons, dialogs, tables) that
we copied into the project rather than installed, so we can edit them. That is
what `src/components/ui/` is.

**TanStack Query** — Handles fetching data and remembering it, so the same list
is not downloaded five times.

**React Router** — Decides which page to show for which web address.

## The storage and login (backend)

**Supabase** — This is the big one. Supabase gives us four things in one:

1. **PostgreSQL**, a database — the filing cabinet where everything is stored.
2. **Auth** — sign-up, sign-in, password reset, done for us.
3. **Storage** — where uploaded files like resumes live.
4. **Edge functions** — small programs that run in the cloud when called.

**Row Level Security (RLS)** — The single most important idea in this project.
It is a rule written *inside the database* saying who may see which rows. For
example: *a college may only read students whose college is theirs.* Because the
rule lives in the database, it applies no matter what the website code does —
even if someone bypassed our website entirely and talked to the database
directly, they still could not see another college's students.

**pg_cron** — A timer inside the database. It runs jobs on a schedule: create
today's tasks at 00:10, score last week on Monday.

## The AI

**DeepSeek** — The AI model used for anything that needs writing or judgement:
inventing the daily task, marking written answers, generating questions from a
student's own submission. It is used because it is far cheaper than the
alternatives for the same quality.

The code is written so a different AI can be swapped in by adding a key — the
file `supabase/functions/_shared/llm.ts` tries DeepSeek first, then Gemini, then
Kimi, skipping any whose key is missing.

## Deployment and tools

**Vercel** — Puts the website on the internet. Every time code is pushed to
GitHub, Vercel rebuilds and publishes it automatically.

**GitHub** — Where the code lives and its history is kept.

**Git** — The tool that records every change, so any mistake can be undone.

**Docker** — Optional. A way of running the project in a sealed box so it
behaves the same on every computer.

## Why there is no separate backend server

Most web projects have three parts: browser, server, database. This one has two.

The reason is cost and simplicity. A server that runs all day costs money all
day, even at 3am when nobody is using it. Instead:

- **Simple rules** (who can see what) live in the database as RLS policies.
- **Complicated logic** (form squads, run the season, score a week) lives in the
  database as *functions* — small programs written in SQL that the database runs.
- **Anything needing the outside world** (calling the AI, sending email) lives in
  an **edge function**, which only runs when called and costs nothing when idle.

The trade-off: a lot of this project's real logic is in SQL, not in the
JavaScript you might expect. Chapter 5 covers those files carefully.

---

# 4. Folder structure

## The tree

```
prooflabai-mvp/
├─ src/                      Everything the browser runs
│  ├─ pages/                 One file per web address
│  ├─ components/            Reusable blocks of screen
│  │  ├─ dashboard/          The four dashboards
│  │  │  ├─ student/         38 screens for students
│  │  │  ├─ college/         23 screens for the college
│  │  │  ├─ admin/           25 screens for the administrator
│  │  │  ├─ startup/         12 screens for companies posting work
│  │  │  ├─ recruiter/       3 screens for recruiters
│  │  │  ├─ season/          2 shared season screens
│  │  │  └─ assignTasks/     Shared task-assigning screen
│  │  ├─ ui/                 32 basic building blocks (button, dialog…)
│  │  ├─ auth/               5 sign-in and email screens
│  │  ├─ onboarding/         8 first-time setup wizards
│  │  ├─ proof/ portfolio/   Small feature-specific blocks
│  │  ├─ feed/ public/
│  │  └─ (13 loose files)    Shared modals and badges
│  ├─ hooks/                 33 files that fetch and share data
│  ├─ lib/                   13 helper tools (PDF reading, audio…)
│  ├─ contexts/              1 file holding who is signed in
│  ├─ integrations/supabase/ The database connection and its type map
│  ├─ recruiter/             Recruiter data layer
│  └─ assets/                Two logo images
│
├─ supabase/                 Everything the database runs
│  ├─ migrations/            86 numbered files, the database's history
│  └─ functions/             38 small cloud programs
│     └─ _shared/            Code used by several of them
│
├─ docs/                     Design documents and references
├─ public/                   Files served as-is (icons, robots.txt)
│
├─ package.json              The project's shopping list
├─ vite.config.ts            Builder settings
├─ tailwind.config.ts        Colour and style settings
├─ tsconfig*.json            Spell-checker settings
├─ Dockerfile                Recipe for the sealed box
├─ docker-compose.yml        How to run that box
├─ setup.sh / setup.ps1      One-command setup for a new machine
├─ vercel.json               Hosting settings
└─ *.md                      The documents you are reading now
```

## What each top-level folder is for

### `src/` — the part you can see

Everything here ends up running inside a visitor's web browser. If you can click
it, it is in here. This is the biggest folder, and inside it the two that matter
most are `pages/` and `components/`.

**How it connects:** `src/` talks to `supabase/` over the internet. It never
talks to the database directly — it goes through the connection defined in
`src/integrations/supabase/client.ts`.

### `src/pages/` — one file per address

When you visit `/student/dashboard`, one file in here is what loads. There are
23 of them. They are mostly thin: a page's job is to decide *which* components to
show, not to contain much logic itself.

### `src/components/` — the reusable blocks

227 files. A component is a piece of screen you can use more than once. This
folder is organised by *who sees it*: student components together, college
components together, and so on. `ui/` is different — those are generic blocks
(a button, a dialog) used by everyone.

### `src/hooks/` — the data fetchers

A "hook" is a React word for reusable logic. Every file here does roughly the
same shape of job: *go and get some data from the database, remember it, and
hand it to whichever screen asked.* `useStudentProfile.tsx` fetches the signed-in
student. `useProofUploads.tsx` fetches their submitted work.

Keeping this separate means several screens can show the same data without each
one fetching it again.

### `src/lib/` — the toolbox

Small, self-contained tools that do one job and do not care about the rest of the
project. Reading text out of a PDF. Turning speech into text. Making a PDF to
download. If a function is useful in more than one place and does not touch the
database, it belongs here.

### `supabase/migrations/` — the database's diary

86 files, each numbered by date. Each one is a small, permanent record of a
change made to the database: a table added, a rule changed, a bug fixed.

**They are never edited after being applied.** If something is wrong, you write a
new file that corrects it. This means the folder read top to bottom is the entire
history of the database, and running them in order on an empty database
reproduces it exactly.

Reading these files, newest first, is genuinely the fastest way to understand how
the system really works — each one explains in its header comment what problem it
was solving.

### `supabase/functions/` — the cloud programs

38 folders, each a small program that runs in the cloud when something calls it.
These exist for jobs the database cannot do alone: talking to the AI, sending
emails, checking a GitHub account, running a student's code safely.

`_shared/` holds the pieces several of them use — the AI connection, rate
limiting, audit logging.

### `docs/` — the thinking

Design documents, architecture notes, and a code review report. These describe
what was intended, which is not always the same as what was built.

### `public/` — served untouched

Files handed to the browser exactly as they are: the favicon (the little icon in
the browser tab), company logos, `robots.txt` (instructions for search engines),
and `whisper-worker.js` (the speech-to-text engine that runs in the browser).

### The loose files at the root

Configuration and documentation. `package.json` is the shopping list of outside
code we use. The `tsconfig` files configure the spell-checker. The `.md` files
are documents. Chapter 5 covers each one.

---
# 5. File-by-file explanation

This chapter covers all 433 files. It is organised the way the project is
organised, so you can follow along with the folders open beside you.

**How depth is allocated.** Roughly forty files carry the real weight of this
project; those get a full walkthrough. The other four hundred are named,
explained in a line or two, and grouped with their family. Nothing is skipped,
but a button component does not get five pages.

Where a file explains itself in a comment at the top, that explanation is used —
the people who wrote it knew best.

---

## 5.1 The files at the root

These configure the project rather than run it.

### File: `package.json`

**Purpose.** The shopping list. It names the project, lists every piece of
outside code the project depends on, and defines the shortcut commands.

*Dependency means: code somebody else wrote that we use rather than writing our
own.*

The commands defined here are the ones you type:

```
npm run dev        start the site on your own computer
npm run build      typecheck, then package it for the internet
npm run typecheck  run the spell-checker only
npm run lint       check code style
```

Notice `build` runs the typecheck first. That is deliberate: a build that would
fail the spell-checker never reaches the internet.

**Connects to:** everything. Every `import` in the project resolves either to a
file in `src/` or to a package listed here.

### File: `package-lock.json` and `bun.lock`

**Purpose.** These record the *exact* version of every dependency, down to the
patch number. `package.json` might say "React 18-ish"; the lock file says
"React 18.3.1 exactly, and here is its fingerprint."

**Why it matters.** Without a lock file, two people installing the same project
on different days can get different code and different bugs. Never edit these by
hand; they are written by the tools.

*(Two lock files exist because the project has been installed with both npm and
bun at different times. `package-lock.json` is the one in use.)*

### File: `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`

**Purpose.** Settings for TypeScript, the spell-checker for code.

The important line lives in `tsconfig.app.json`:

```json
"strict": false
```

**What that means in plain words.** The spell-checker is on its relaxed setting.
It will catch a misspelled variable, but it will *not* warn you that a value
might be missing, and it cannot know that a database column was renamed.

**Why you must care.** In this project, code compiling successfully proves very
little. The database is a separate system; TypeScript cannot see inside it. The
only real proof that something works is running it against the real database
while signed in as a real user.

### File: `vite.config.ts`

**Purpose.** Settings for the builder. Sets the local port to 8080, sets up the
`@/` shortcut so imports can say `@/components/ui/button` instead of counting
`../../..`, and splits the output into chunks so a visitor does not download the
entire site to see the front page.

### File: `tailwind.config.ts`

**Purpose.** Defines the design: the colours, the fonts, the spacing, and dark
mode. If you want to change the project's colour scheme, this is the file.

### File: `postcss.config.js`

**Purpose.** Three lines of plumbing that let Tailwind run. You will almost
certainly never touch it.

### File: `components.json`

**Purpose.** Settings for shadcn/ui — where new components should be placed when
you add one. Only read by the shadcn command-line tool.

### File: `eslint.config.js`

**Purpose.** Code-style rules. Catches things like unused variables. Style
opinions, not correctness.

### File: `index.html`

**Purpose.** The single web page that the entire site is built inside. It is
almost empty on purpose — one empty `<div id="root">` that React fills in, plus
the page title and the preview card that appears when someone shares a link.

*This is what "single-page application" means: the browser loads one HTML file
once, and JavaScript redraws the inside of it as you navigate.*

### File: `vercel.json`

**Purpose.** One instruction to the hosting company: *whatever address is asked
for, serve `index.html` and let the JavaScript sort it out.* Without this, going
straight to `/student/dashboard` would show a "not found" error, because no such
file exists on the server — the address only means something once React is
running.

### File: `Dockerfile` and `docker-compose.yml`

**Purpose.** A recipe for running the project inside a sealed box, so it behaves
identically on every computer. Optional. `docker compose up` starts it on
port 8080.

### File: `setup.sh` and `setup.ps1`

**Purpose.** One-command setup for a fresh machine — `setup.sh` for Mac and
Linux, `setup.ps1` for Windows. They check your Node version, install the
dependencies, and tell you what to run next.

### File: `.gitignore` and `.dockerignore`

**Purpose.** Lists of things *not* to include. `node_modules` (hundreds of
megabytes of downloaded code), build output, and any secret files. This is what
keeps passwords out of the code history.

### File: `.env.example`

**Purpose.** A template showing what environment variables would be needed.

**Note:** this project does not actually need a `.env` file to run — the
Supabase address and public key are written directly into
`src/integrations/supabase/client.ts`. This file is left over and its contents
are out of date.

*Environment variable means: a setting kept outside the code, usually because it
is secret or changes between computers.*

### File: `deno.lock`

**Purpose.** The lock file for the edge functions, which run on Deno rather than
Node. Same idea as `package-lock.json`, different world.

### The Markdown documents

| File | What it is |
| --- | --- |
| `README.md` | The front door — what this is, how to run it |
| `START_HERE.md` | **The most current document.** Working rules, branch rules, the shared-database rule |
| `CLAUDE.md` | Instructions for the AI assistant working on this repo |
| `SQUAD_SYSTEM.md` | How the league, season, qualification and awards work |
| `HANDOFF.md` | An older handover note; product descriptions hold, table names are stale |
| `RECRUITER_BRIEF.md` | The specification the recruiter dashboard was built from |
| `RECRUITER_API.md` | The exact data shapes the recruiter screens call |
| `E2E_TEST_SCRIPT.md` | A manual click-through test script |
| `RESUME_FEATURE_STATUS.md` | Notes on the resume-checking feature |
| `DOCUMENTATION.md` | This book |

> **A warning that applies to all of them:** these documents describe the product
> accurately, but any specific table name, row count or migration number in the
> older ones is likely out of date. The database is the truth. `START_HERE.md`
> and `SQUAD_SYSTEM.md` are the two kept current.

---

## 5.2 The starting point: `src/`

### File: `src/main.tsx`

**Purpose.** The very first line of code that runs. Four lines long. It finds
the empty `<div id="root">` in `index.html` and tells React to draw the
application inside it.

**Connects to:** `App.tsx`, which it renders, and `index.css`, which it loads.

### File: `src/App.tsx` (244 lines)

**Purpose.** The map of the whole website. Every address a visitor can reach is
listed here, along with who is allowed to reach it.

**Main parts.**

**1. Lazy loading.** Almost every page is imported like this:

```ts
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
```

`lazy` means *do not download this page's code until somebody actually visits
it.* Without it, a visitor to the front page would download the admin dashboard,
the recruiter screens and the resume checker before seeing anything. A comment
in the file marks which few pages are on the "critical path" and loaded
immediately.

**2. The providers.** The app is wrapped in several layers, each providing
something to everything inside it:

- `QueryClientProvider` — the data-fetching system
- `AuthProvider` — who is signed in
- `ThemeProvider` — light or dark mode
- `TooltipProvider` — hover labels
- `BrowserRouter` — the address bar
- `ErrorBoundary` — catches crashes so the page does not go blank

**3. The routes.** The heart of the file. Each route maps an address to a page:

```tsx
<Route path="/student/dashboard" element={
  <RoleBasedProtectedRoute allowedRoles={['student']}>
    <StudentDashboard />
  </RoleBasedProtectedRoute>
} />
```

Read it as a sentence: *at the address `/student/dashboard`, if the signed-in
person is a student, show the student dashboard.* The wrapper is what enforces
the "if".

Public addresses (`/`, `/auth`, `/pricing`, `/portfolio/:slug`) have no wrapper —
anyone may visit.

**Connects to:** every page in `src/pages/`, plus the two route guards.

### File: `src/index.css` and `src/App.css`

**Purpose.** The global stylesheet. `index.css` defines the colour variables
that Tailwind and the components use, and the light/dark palettes. `App.css` is
mostly leftover from the original template.

### File: `src/vite-env.d.ts`

**Purpose.** One line telling TypeScript about Vite's special features. Never
edited.

### File: `src/contexts/AuthContext.tsx`

**Purpose.** Holds the answer to "who is signed in?" in one place, so every
screen can ask without each one checking separately.

**How it works.** It asks Supabase for the current session when the app starts,
then *subscribes* to changes — so if you sign out in another browser tab, this
screen notices. It hands down two things: `user` (the signed-in person, or
nothing) and `loading` (whether we have finished checking yet).

That `loading` flag matters more than it looks. Without it, screens would flash
"please sign in" for half a second before realising you were signed in all along.

**Connects to:** `ProtectedRoute`, `RoleBasedProtectedRoute`, and any screen that
needs to know who the user is.

### File: `src/integrations/supabase/client.ts`

**Purpose.** The single connection to the database. Every part of the project
that reads or writes data goes through the `supabase` object created here.

```ts
const SUPABASE_URL = "https://ajaeneehxlnmnhjtvrgs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGci...";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ...);
```

**Is it safe that a key is written in the code?** Yes, and this confuses
everyone at first. This is the *publishable* key — it is designed to be visible.
Anyone can read it in the browser. It does not grant permission to anything; it
only identifies which project you are talking to. What actually protects the data
is Row Level Security inside the database, which decides per row whether the
signed-in person may see it. The *secret* key, which does bypass those rules, is
never in this project — it lives only in the edge functions' settings.

**Connects to:** roughly two hundred files. This is the busiest file in the
project.

### File: `src/integrations/supabase/types.ts` (4,686 lines)

**Purpose.** A machine-written map of the entire database — every table, every
column, every function, and their types.

**Never edit this file by hand.** It is regenerated from the live database with
a command whenever the schema changes. Its whole value is that it matches
reality; hand-editing breaks that.

**What it buys you.** Because of this file, typing `supabase.from("studnet_profiles")`
is an error before you run anything, and your editor can autocomplete column
names.

### File: `src/components/ProtectedRoute.tsx`

**Purpose.** A wrapper meaning "you must be signed in". If nobody is signed in,
it redirects to `/auth`. While it is still checking, it shows a spinner rather
than guessing.

### File: `src/components/RoleBasedProtectedRoute.tsx`

**Purpose.** The stricter wrapper: "you must be signed in **and** be one of
these roles."

**Walkthrough.** It looks up the signed-in person's role, then:

- **No role row at all?** That happens when sign-up half-failed. It creates a
  student role and sends them to the student start page rather than showing an
  error.
- **Role found, but onboarding not finished?** Send them to the wizard first —
  except for admins (who never do onboarding), students (gated by their own
  intake flow instead), and recruiters (whose one-time setup is a form on their
  own dashboard).
- **Role found and allowed?** Show the page.
- **Role found but not allowed?** Send them to their own dashboard.

That list of exceptions is the interesting part, and each one is there because
somebody got trapped in a loop without it.

**Connects to:** `App.tsx` (which uses it on nearly every route) and
`AuthContext`.

### File: `src/components/ErrorBoundary.tsx`

**Purpose.** Catches a crash in any screen and shows what went wrong, instead of
letting React blank the entire page. Without it, one bad component turns the
whole site white with no explanation.

### File: `src/components/Logo.tsx`, `ThemeToggle.tsx`, `StickyCtaBar.tsx`, `OnboardingModal.tsx`, `AppGuideChatbot.tsx`

Small shared pieces: the logo (which swaps for dark mode), the light/dark
switch, the floating call-to-action bar on the front page, a first-visit modal,
and a help chatbot that answers questions about how to use the site by calling
the `app-guide-chat` edge function.

### Files: `src/assets/logo-light.png`, `logo-dark.png`

The two logo images, one for each theme.

---

## 5.3 The pages — `src/pages/`

A page is what loads at one web address. Most are deliberately thin: they choose
which components to show and pass data between them.

| File | Lines | What it is |
| --- | --- | --- |
| `Index.tsx` | 649 | The public front page. The largest page file — it is the marketing site: hero, features, testimonials, pricing teaser |
| `Auth.tsx` | 249 | Sign in and sign up. Also decides where to send you afterwards based on your role |
| `AuthCallback.tsx` | 281 | Where you land after clicking an email confirmation link |
| `ResetPassword.tsx` | 155 | Set a new password after a reset email |
| `Pricing.tsx` | 311 | Public pricing page |
| `NotFound.tsx` | 28 | Shown for an address that does not exist |
| `StudentStart.tsx` | 183 | Catches a student who signed up themselves and has no profile row yet, and creates one |
| `StudentDashboard.tsx` | 115 | The student's home. Four destinations: Daily Card, Build-Log, Squad, Profile |
| `StudentInterestOnboarding.tsx` | 260 | The "skip the resume" path — builds the same scorecard from declared interests |
| `StudentResumeOnboarding.tsx` | 92 | The resume-upload path into the same place |
| `OnboardingWizard.tsx` | 137 | Generic first-time setup, routed by role |
| `OnboardingStudent.tsx` / `OnboardingCollege.tsx` / `OnboardingStartup.tsx` | 45–63 | Thin wrappers around each role's wizard |
| `CollegeDashboard.tsx` | 66 | The college's home; switches between Home, Students, Squads, Insights |
| `AdminDashboard.tsx` | 132 | The administrator's home; a switch statement mapping menu choices to screens |
| `AdminNotifications.tsx` | 179 | The administrator's notification list |
| `StartupDashboard.tsx` | 58 | The company's home |
| `RecruiterDashboard.tsx` | 141 | The recruiter's home. Also holds the one-time "who are you hiring for?" form |
| `RecruiterView.tsx` | 325 | A read-only view of a student, reached by a shareable link a college generates |
| `Portfolio.tsx` | 428 | A student's public portfolio page at `/portfolio/:slug` |
| `ProofViewer.tsx` | 292 | Views one submitted piece of work in detail |
| `ReviewProofs.tsx` | 66 | The proof review queue |

### Deep dive: `src/pages/Auth.tsx`

Worth understanding because every single user passes through it.

**Part 1 — clearing a stale session.** When the page loads it checks whether an
old sign-in is still hanging around, and whether that person actually finished
setting up. If the check times out, it signs them out rather than leaving them
stuck.

**Part 2 — `redirectToDashboard(role)`.** A simple switch: admin goes to
`/admin/dashboard`, college to `/college/dashboard`, startup to
`/startup/dashboard`, recruiter to `/recruiter/dashboard`, student to
`/student/dashboard`.

**Part 3 — `handleAuthSuccess(role)`.** What happens the moment sign-in
succeeds. It checks whether the person has finished onboarding, then routes:
students to their intake flow, colleges and startups to their wizards, recruiters
straight to their own dashboard, everyone else to the generic wizard.

That recruiter branch was added because without it a recruiter was thrown into
the *student* wizard and could never escape.

---
## 5.4 The building blocks — `src/components/ui/` (32 files)

These are the smallest pieces: button, dialog, table, input, and so on. They
come from **shadcn/ui**, a library that works differently from most — instead of
installing it, you copy the components into your own project so you can edit
them.

| Files |
| --- |
| `alert`, `avatar`, `badge`, `button`, `calendar`, `card`, `checkbox`, `collapsible`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `toast`, `toaster`, `tooltip`, `use-toast` |

**What to know as a beginner.** You will rarely need to open these. They are the
vocabulary the rest of the project speaks: when a screen says `<Button>` or
`<Card>`, this is where that comes from. They handle keyboard navigation and
screen-reader labels for you, which is why using them is better than writing a
raw `<button>`.

**One to be careful with:** `sidebar.tsx` is large and is used by all four
dashboards. A change here shows up in every one of them.

---

## 5.5 Sign-in and onboarding

### `src/components/auth/` (5 files)

| File | What it does |
| --- | --- |
| `EnhancedRoleBasedAuthForm.tsx` | The main sign-in / sign-up form. Includes the role picker — student, college, startup, recruiter — and writes the chosen role into the database on sign-up |
| `PasswordInput.tsx` | A password box with a show/hide eye |
| `EmailVerificationPrompt.tsx` | "Check your email" message |
| `EmailVerificationScreen.tsx` | Full-screen version of the same |
| `EmailConfirmationRequired.tsx` | Blocks a screen until the email is confirmed |

**Worth knowing:** the sign-up form writes the role from the browser. The
database has a rule (`user_roles_self_claim`) listing which roles a person may
give themselves — student, college_admin, startup, recruiter. `admin` is
deliberately not on that list, so nobody can make themselves an administrator.

### `src/components/onboarding/` (8 files)

The first-time setup wizards, one family per role.

| File | What it does |
| --- | --- |
| `WelcomeScreen.tsx` | The one-time welcome a student sees after confirming their email |
| `IntakeChoice.tsx` | "Upload your resume" or "skip and tell us your interests" |
| `StudentWizard.tsx` | The student's setup — including the interest list that feeds their learning tracks |
| `InterestReview.tsx` | Confirms the interests picked, before committing |
| `CollegeWizard.tsx` / `CollegeMultiStepWizard.tsx` | The college's setup |
| `StartupWizard.tsx` / `StartupMultiStepWizard.tsx` | The company's setup |

---

## 5.6 The student dashboard — `src/components/dashboard/student/` (38 files)

The largest family. Grouped by what they are for.

**The daily loop — the heart of the product**

| File | What it does |
| --- | --- |
| `StudentDailyCard.tsx` | Today's task. The single most important screen a student sees |
| `VoiceExplainModal.tsx` | Records the sixty-second spoken explanation |
| `ConceptualQuestionsModal.tsx` | Asks questions generated from the student's own submission |
| `TaskDetailsDialog.tsx` | The full text of a task |
| `ThisWeekPlan.tsx` | What is planned for the week ahead |

**Progress and the ladder**

| File | What it does |
| --- | --- |
| `LevelMap.tsx`, `LevelPath.tsx`, `LevelDetail.tsx` | The 197-topic ladder: the map, the route through it, one step |
| `RoadmapStages.tsx`, `StudentRoadmapPage.tsx` | The longer-term plan |
| `StudentProgressPage.tsx` | Overall progress |
| `StudentHistory.tsx` | Everything done so far |
| `CodingStreaks.tsx` | Day streaks, including LeetCode if connected |
| `StudentAchievements.tsx` | Badges earned |
| `StudentSkillsProved.tsx` | Skills with evidence behind them |
| `SkillGap.tsx` | What is missing for a target role |

**Squad and season**

| File | What it does |
| --- | --- |
| `StudentSquadPage.tsx` | The squad: standings, members, matches, achievements, leaderboards |
| `StudentSeasonReport.tsx` | The end-of-season summary |

**Resume checking** — a substantial feature of its own

| File | What it does |
| --- | --- |
| `ResumeCheckFlow.tsx` (954 lines) | The whole resume-checking journey, start to finish |
| `TimedResumeAssessment.tsx` (840) | The timed test that follows |
| `StudentResumeCheckPage.tsx`, `StudentResumeHistoryPage.tsx` | Entry point and past attempts |
| `StudentCertifications.tsx` | Certificates and their evidence |

**Proof and portfolio**

| File | What it does |
| --- | --- |
| `StudentUploadsPage.tsx` | Files uploaded as proof |
| `StudentPortfolioPage.tsx` | The public portfolio, **including the Public/Private switch that makes a student visible to recruiters** |
| `StudentCosigns.tsx` | Classmates vouching for work |
| `AppealSubmissionModal.tsx` | Appealing a rejected proof |
| `CodeSnapshot.tsx`, `CodeSandboxEmbed.tsx` | Showing and running code |

**Interview practice**

| File | What it does |
| --- | --- |
| `MockInterview.tsx` | Practice interview with AI-generated questions and scoring |

**Frame and settings**

| File | What it does |
| --- | --- |
| `StudentSidebar.tsx`, `StudentHeader.tsx`, `StudentDashboardContent.tsx` | The frame every student screen sits in |
| `StudentSettingsPage.tsx`, `StudentPrivacy.tsx` | Settings, and the profile-visibility control |
| `StudentRolePreference.tsx` | Target job role |
| `StudentNotificationsPage.tsx` | Notifications |
| `StudentAssignedTasksPage.tsx` | Tasks assigned directly by an admin or college |

### Deep dive: `StudentSquadPage.tsx` (419 lines)

**Purpose.** Everything a student sees about their team and the season.

**How it loads.** One `load()` function fetches five things at once rather than
one after another — the squad, its members, recent matches, the standings, and
the achievements. Fetching in parallel is why the page appears quickly.

**The standings are filtered to the student's own cohort.** A student in CSE-A
sees the CSE-A table, not every squad in the college. A table full of sections
you never play is not a standing.

**The qualification message.** Once the league ends, the page shows one of two
things. If the squad went through: *"Through to the championship as seed N."* If
it did not:

> The championship race is over for this squad. Your daily work, your score and
> every individual award carry on to the end of the season exactly as before.

That sentence is the product's most important promise rendered as text.

**Tabs:** Overview, Members, Matches, Standings, Achievements, Leaderboards,
Season. Members are listed in join order, deliberately *not* ranked — the design
says squadmates are not ranked against each other.

---

## 5.7 The college dashboard — `src/components/dashboard/college/` (23 files)

| File | What it does |
| --- | --- |
| `TpoHome.tsx` | The college's home screen |
| `TpoStudents.tsx`, `StudentsManagement.tsx` | The student list |
| `TpoStudentProfile.tsx`, `StudentProfileModal.tsx` | One student in detail |
| `TpoImportStudents.tsx` | **Uploading the student spreadsheet** — validation, duplicates, error report, and the section column that creates cohorts |
| `TpoSquads.tsx` (1,081 lines) | **Squads: standings, members, matches, assign, manage, performance, achievements, leaderboards** |
| `TpoInsights.tsx` | Trends: who is moving, who has gone quiet |
| `PostJobDescription.tsx` | Post a real job description, which the task engine then writes tasks from |
| `RecruiterLinksPage.tsx`, `GenerateRecruiterLinkModal.tsx` | Shareable read-only links to a student |
| `UploadedProofs.tsx`, `TrustScoresSection.tsx` | Submitted work and trust scores |
| `VerificationSettingsPage.tsx`, `VerificationTrendsPage.tsx` | How strictly work is checked, and the resulting trends |
| `CollegeProfilePage.tsx`, `CollegeSettingsPage.tsx` | Profile and settings |
| `NotificationsSection.tsx` | Notifications |
| `CollegeDashboardContent.tsx`, `CollegeDashboardHeader.tsx`, `CollegeDashboardSidebar.tsx`, `CollegeDashboardOverview.tsx` | The frame |
| `AssignTasks.tsx` | Thin wrapper around the shared assign-tasks screen |

### Deep dive: `TpoImportStudents.tsx`

**Purpose.** Turning a spreadsheet into student accounts. This is how every
student enters the system.

**The steps, in order:**

1. The college picks which branch the file is for (CSE, ECE…).
2. The file is read in the browser. The first row is treated as column headings.
3. Column names are matched flexibly — `roll_number`, `roll_no`, `rollno` and
   `roll` all mean the same thing.
4. **The `section` column** (also accepted as `sec`, `class`, `division`,
   `cohort`) is joined to the branch: `CSE` + `A` becomes the cohort `CSE-A`.
   Without that column, the whole branch competes as one group.
5. Every row is validated: name present, email present, email shaped like an
   email, not already on the platform, not repeated within this file.
6. A phone number that is not ten digits does not reject the student — it is
   reported and the student is imported without it. The email is what the
   invitation needs.
7. Valid rows go to the `create-student-users` edge function, which creates the
   accounts and sends invitations.
8. Because that function has no cohort argument, the cohorts are set immediately
   afterwards in a second call to `tpo_set_cohorts`.
9. Every row's outcome is reported, and the failures can be downloaded as a CSV.

**Connects to:** the `create-student-users` edge function, the `tpo_set_cohorts`
database function, and the `student_imports` table which records the job.

### Deep dive: `TpoSquads.tsx` (1,081 lines)

The biggest college screen, organised as eight tabs.

| Tab | What it shows |
| --- | --- |
| **Standings** | The league table, grouped by cohort, with a Championship column |
| **Overview** | One squad's summary |
| **Members** | Who is in it |
| **Matches** | Fixtures with their stage and week |
| **Assign** | Place students who have no squad |
| **Manage** | Form squads, rebalance, create a squad by hand, lock, archive, scoring weights, naming themes |
| **Performance** | Weekly points, participation, movement |
| **Achievements** | What squads have won |
| **Leaderboards** | The individual side |

**The season phase bar** sits above all of it, showing which of the six phases
the season is in.

**One detail worth understanding.** The position number in Standings counts
*within the cohort*, not across the college — because that is the league the
squad actually plays in.

---

## 5.8 The admin dashboard — `src/components/dashboard/admin/` (25 files)

| File | What it does |
| --- | --- |
| `AdminDashboardOverview.tsx` | The home screen with counts |
| `AdminSidebar.tsx`, `AdminHeader.tsx` | The frame and menu |
| `EnhancedUserManagement.tsx` (849 lines) | Students, colleges and startups in one screen |
| `StudentOversight.tsx`, `CollegeOversight.tsx`, `StartupOversight.tsx` | Per-role oversight |
| `RecruiterOversight.tsx` | **Approving recruiters.** Until this existed, a recruiter could sign up and wait forever |
| `ProofSubmissionsContent.tsx` (777) | The proof review queue |
| `TaskOversight.tsx`, `TaskDetailsModal.tsx`, `EditTaskModal.tsx`, `ReassignTaskModal.tsx`, `ViewAssignedStudentsModal.tsx` | Task management |
| `AdminAssignTasks.tsx` | Wrapper around the shared assign-tasks screen |
| `ContentManagement.tsx`, `ManageJobsPage.tsx`, `ManageResourcesPage.tsx`, `ManageAnnouncementsPage.tsx` | Jobs, resources, announcements |
| `AdminAnalytics.tsx` | Platform-wide numbers |
| `TokenUsage.tsx` | How much AI is being used and by whom |
| `SecurityEvents.tsx` | Security log |
| `TrustXPModeration.tsx` | Adjusting trust and XP by hand |
| `SystemSettings.tsx` | System settings **and the administrator list** |
| `AdminNotificationsPopover.tsx` | Notifications dropdown |

### Deep dive: `RecruiterOversight.tsx`

**Purpose.** The screen that lets an administrator approve a recruiter.

**Why it matters.** A recruiter who signs up starts with `verified = false`, and
sees no candidates at all until someone flips it. The database functions to do
that existed for weeks, but nothing called them — so this screen is what makes
the whole recruiter half of the product reachable.

**How it works.** It calls `admin_recruiters()` to list every recruiter with
their shortlist and sponsored-work counts, and `admin_verify_recruiter(id, true)`
to approve or un-approve. Waiting recruiters are counted in a badge at the top so
they are not missed.

---

## 5.9 The remaining component families

### `src/components/dashboard/startup/` (12 files)

For companies that post work directly. `StartupPostTaskPage.tsx` posts a task,
`StartupSubmissionsPage.tsx` reviews what came back,
`StartupViewApplicationsPage.tsx` handles applications,
`StartupJobsPage.tsx` manages job posts, plus the usual frame, settings, and a
`VerificationBanner.tsx` shown until the company is approved.

### `src/components/dashboard/recruiter/` (3 files)

| File | What it does |
| --- | --- |
| `RecruiterDashboardContent.tsx` (497) | All four recruiter sections: Home, Talent, Shortlist, Lots |
| `ProofProfile.tsx` (194) | **The screen the whole product exists to produce** — one student's evidence in full |
| `RecruiterDashboardSidebar.tsx` | The four-item menu |

### `src/components/dashboard/season/` (2 files)

Shared by the student and college dashboards — the same component in both places.

| File | What it does |
| --- | --- |
| `SeasonPhaseBar.tsx` | Which week it is, which of the six phases, and a strip showing progress through them. Also carries the sentence explaining that failing to qualify ends only the competition |
| `SeasonLeaderboards.tsx` | The six individual tables and the seven awards, with the reader's own row highlighted |

### `src/components/dashboard/assignTasks/` (2 files)

`AssignTasksScreen.tsx` (2,755 lines — the largest file in the project) plus
`useTaskForms.ts`. One screen used by *both* the admin and the college, told
which it is by a `scope` setting. Before it was shared, the college's copy
existed but no button pointed at it.

### The loose dashboard files (13)

Shared modals and badges used across roles: `UploadProofModal`,
`VerificationPanel`, `VerificationBadges`, `VerificationDropdown`,
`VerificationSummaryModal`, `EnhancedVerificationModal`, `ReflectionModal`,
`IntegrityDeclarationModal`, `IntegrityContextPanel`, `TrustTrendBadge`,
`ProfilePhotoModal`, `ProfilePhotoModalUniversal`, `NotificationsSection`.

### `src/components/proof/`, `portfolio/`, `feed/`, `public/`

Four small folders: `ProofFileButton.tsx` (opens a private file safely),
`PublicProjectCard.tsx`, `PublicSuggestedStudents.tsx`, and for the public
recruiter view `RecruiterHeader.tsx` and `ContactStudentModal.tsx`.

### `src/recruiter/`

| File | What it does |
| --- | --- |
| `data.ts` (292 lines) | Every database call the recruiter screens make, in one place |
| `types.ts` | The shapes of a candidate, a skill, a shortlist entry |

Keeping all the calls in `data.ts` means the screens contain no database code at
all — a pattern worth copying.

---

## 5.10 The data fetchers — `src/hooks/` (33 files)

A **hook** is reusable logic in React. Every file here has the same shape: fetch
something, remember it, hand it over, and re-fetch when it changes.

| Hook | Fetches |
| --- | --- |
| `useStudentProfile` | The signed-in student's profile |
| `useStudentIntake` | State for the welcome screen and the resume-or-skip choice |
| `useAllStudentTasks` (310) | Every task assigned to a student |
| `useTaskStats`, `useMonthlyXP` | Counts and monthly XP |
| `useProofUploads`, `useProofReviews`, `useProofAppeals` | Submitted work, its reviews, its appeals |
| `useVerifyProof`, `useFullVerification`, `useVerificationSettings` | Verification |
| `usePortfolio`, `usePortfolioProjects`, `usePublicScorecard` | Portfolio and public scorecard |
| `useConceptualTests`, `useReflectionRequest` | Follow-up questions and reflection |
| `useCollegeProfile`, `useCollegeNotifications` | College data |
| `useStartupProfile`, `useStartupTasks`, `useStartupSubmissions`, `useStartupStats`, `useStartupActivity`, `useStartupNotifications`, `useStartupVerification` | The company side |
| `useTaskApplications` (227) | Applications to tasks |
| `useAdminNotifications`, `useNotifications` | Notifications |
| `use-toast`, `use-mobile` | Pop-up messages; whether the screen is phone-sized |

---

## 5.11 The toolbox — `src/lib/` (13 files)

Small tools that do one job. Several are genuinely clever and worth reading.

### `pdfText.ts` (201 lines) — reading a PDF in the browser

Pulls the text out of an uploaded resume **without sending it anywhere**. It
reads the words and their positions, groups them into lines by matching
baselines, and detects two-column layouts by finding a shared vertical gap —
because a two-column CV otherwise comes out interleaved and unreadable.

If a page has almost no text, it assumes the file is a scan and runs OCR
(reading text from a picture) instead, capped at five pages.

**Why this matters:** it is free, private, and has no time limit, because it
never leaves the student's computer.

### `transcribeAudio.ts` (87 lines) — speech to text in the browser

Turns the sixty-second recording into text using Whisper, running entirely
locally. No server, no API key, no cost per recording.

### `cleanTranscript.ts` — fixing what speech-to-text gets wrong

Corrects the handful of things reliably misheard: technical terms, and
punctuation that was spoken aloud.

### The rest

| File | What it does |
| --- | --- |
| `ensureStudentProfile.ts` | Guarantees a signed-in student has a profile row; sign-up used to leave some without one |
| `proofFile.ts` | Opens a file in a private bucket safely, by asking for a temporary link |
| `exportTranscriptPdf.ts` | Downloads one spoken answer as a neat PDF |
| `resumePdf.ts` | Builds the resume PDF |
| `securityLog.ts` | Reports sign-in events that no server-side code can see |
| `staleChunkReload.ts` | Rescues a browser tab left open across a deploy, whose code no longer exists |
| `studentFilters.ts` | Shared filtering for the two assign-tasks screens |
| `targetRoles.ts` | The list of target job roles, mirroring the server's copy |
| `functionError.ts` | Reads the real error message out of a failed edge-function call |
| `utils.ts` | Small helpers, including turning "Asha Kumar" into "AK" for avatars |

---
## 5.12 The database — `supabase/migrations/` (86 files)

### What a migration is

A **migration** is one file containing one change to the database. Add a table.
Change a rule. Fix a bug. Each is numbered by date, and once applied it is
**never edited again** — if it was wrong, you write a new file that corrects it.

Read in order, this folder is the complete history of the database. Read
backwards, it is the fastest way to understand how the system really works,
because each file's header comment explains the problem it solved.

**Why this rule exists.** If people edited old migrations, then running them on
a fresh database would produce something different from the live one, and nobody
could tell which was correct.

### The stages, grouped

Rather than list 86 files individually, here is what each group did. The stage
numbers are in the filenames.

| Stages | What was built |
| --- | --- |
| **1–4** | Foundations: who a user is, their role, the first tables, and protection for columns the system owns |
| **5** | The learning ladder — tracks, levels, and suggesting tracks to a student |
| **6–7** | Voice explanations, streaks, and the first version of squads |
| **8–9** | Filling gaps in the dashboards |
| **10** | The college dashboard |
| **11–13** | Resources, badges, quests, the award engine, and a cache so the AI is not asked the same thing twice |
| **14** | The admin dashboard, and job postings |
| **15** | The TPO's tools: student profiles, attention reasons, audit history |
| **16–19** | Squad scoring, round-robin fixtures, scale fixes, and security hardening |
| **21–24** | The hybrid roadmap, podiums, scorecards, insights |
| **25–28** | **The Daily Lot engine** — the core of the product — plus retests, unlock rules, and quiz shuffling |
| **29–32** | Task templates, safe concurrent access, draws and tie-breaks |
| **33–34** | Flow corrections, and keeping the two sign-up doors separate |
| **35 (a–g)** | **The recruiter role** — workspace, talent search, proof profile, shortlists, sponsored work, verification |
| **36–41** | Season reports, fixtures, readiness, mock interviews, configurable scoring, naming themes |
| **42–44** | Squads on import, the five new tracks, and a fix to a policy that was silently always false |
| **45–48** | Real job descriptions feeding tasks, and three security migrations |
| **49–54** | **The squad system rebuilt to the blueprint** — cohorts, the twelve-week season, league, championship, awards, squads of eleven |
| **55–58** | **The adaptive engine** — per-topic ratings, placement, new answer types, the source registry |
| **59** | Repairs to two admin screens broken by changes made elsewhere |

### Six migrations worth reading in full

**`stage25_daily_lot_engine`** — the heart of the product. Creates the machinery
that decides what work each student receives each day.

**`stage44_fix_tasks_assigned_read`** — a lesson in how bugs hide. A security
rule compared `task_assignments.task_id = task_assignments.id` — comparing a row
to itself, which is always false. The effect: any privately assigned task was
invisible to the student it was assigned to. It looked correct at a glance for
months.

**`stage46_close_anon_execute_and_view_writes`** — closed a real hole. Fourteen
functions could be called by a complete stranger with no account. Two of them
returned real data. The header explains a trap: revoking a permission from
`anon` alone does nothing if the permission came through `PUBLIC` — you must
revoke from `PUBLIC`, `anon` and `authenticated`, then grant back to
`service_role` by name.

**`stage49_cohorts_and_season_shape`** — introduces the cohort (the academic
section) and the twelve-week season with named phases.

**`stage50_league_qualification_championship`** — the whole competition: cohort
league, qualification, championship, seeding, semi-finals, final. Includes
`advance_season()`, which reads the current phase and builds whatever that phase
needs, so the season runs itself.

**`stage55_per_topic_rating`** — the adaptive brain. Creates `topic_ratings`, and
states the rule the specification calls its highest priority: **per-topic scores
must never be averaged into one number.** Being strong at Percentages says
nothing about Dynamic Programming.

### The other database files

| File | What it is |
| --- | --- |
| `supabase/config.toml` | Settings for each edge function, including whether it requires sign-in |
| `supabase/seed_test_accounts_cleanup.sql` | Deletes all test data before real students arrive |
| `supabase/tests/smoke_test.sql` | A quick check that the basics still work |
| `supabase/.temp/linked-project.json` | Which Supabase project this folder is connected to |

---

## 5.13 The cloud programs — `supabase/functions/` (38 folders)

An **edge function** is a small program that runs in the cloud only when called,
and costs nothing when idle. They exist for jobs the database cannot do alone —
mainly talking to the AI.

Each folder contains one `index.ts`.

### `_shared/` — used by several functions

| File | What it does |
| --- | --- |
| `llm.ts` | **The AI connection.** Tries DeepSeek, then Gemini, then Kimi, skipping any whose key is missing. Every AI call in the project goes through here |
| `rate-limit.ts` | Stops one user from calling something a thousand times |
| `audit.ts` | Records security events |
| `levels.ts`, `skill-map.ts`, `role-skills.ts` | Shared knowledge about the ladder, skills, and which skills a role needs |

### The functions, by what they are for

**Creating the daily work**

| Function | What it does |
| --- | --- |
| `lot-writer` | Writes the daily task for a topic. Uses a **real posted job description** when one exists for that skill, and invents a realistic scenario when none does |
| `generate-task-ai` | Generates a task |
| `assign_tasks` | Assigns tasks to students |
| `levels-warm`, `level-open`, `levels-place` | Prepares a ladder step's content, opens it, and places a new student at the right level |
| `level-quiz-submit` | Marks the quiz at a ladder step |

**Checking the work is real**

| Function | What it does |
| --- | --- |
| `verify-proof` | The main verification |
| `ai-authorship` | Judges how likely it is that AI wrote the submission |
| `github-check`, `test-github-connection` | Checks a GitHub account and its commit history |
| `moss-check` | Similarity checking against other submissions |
| `trust-compute` | Calculates the trust score |
| `question-generator`, `submit-conceptual-answers` | Generates questions from the student's own work, and marks the answers |
| `response-evaluator` | Marks written answers |
| `voice-score` | Scores the spoken explanation |

**The resume feature**

`resume-parser`, `resume-question-generator`, `resume-assessment-submit`,
`resume-coding-generate`, `resume-code-execute`, `resume-jd-match`,
`resume-improve`, `resume-cert-radar`, `resume-retest-generate`,
`resume-voice-verify` — parsing the file, generating questions from it, running
code safely, matching against a job description, suggesting improvements, and
re-testing.

**Interviews and interests**

`mock-interview-generate`, `mock-interview-score`, `interests-analyze`.

**Accounts and housekeeping**

| Function | What it does |
| --- | --- |
| `create-student-users` | Creates accounts in bulk from the CSV import |
| `create-college-user` | Creates a college account |
| `send-onboarding-email` | Sends the invitation |
| `proof-file-url` | Hands out a temporary link to a private file |
| `security-log` | Records sign-in events |
| `reset-daily-credits` | Nightly reset |
| `leetcode-streak-sync` | Pulls a student's LeetCode streak |
| `app-guide-chat` | The in-app help chatbot |

### Deep dive: `lot-writer`

**Purpose.** Writing the daily task. This is where the AI is most visible in the
product.

**How it runs.** For a given ladder step it looks for the newest approved job
posting whose role or description mentions that step's skill. If one exists, the
task is written *from that real posting*. If none exists, the AI invents a
realistic scenario instead.

**A caution written into the design.** Tasks are written once per topic and
cached forever, so a job description posted today only affects topics not yet
written. It is never retroactive.

**Its guard.** The function checks the caller has a real signed-in identity
before doing anything, and returns `{"error":"Unauthorized"}` otherwise.

---

## 5.14 `docs/` and `public/`

### `docs/`

| File | What it is |
| --- | --- |
| `prooflabai-founder-blueprint.md` | The original vision |
| `prooflabai-product-document.md` | The product description |
| `architecture-refs/master-system-architecture.md` | Intended architecture |
| `architecture-refs/master-minimum-navigation.md` | **The four-item navigation rule** every role follows |
| `architecture-refs/student-dashboard.md`, `tpo-dashboard.md` | Per-dashboard designs |
| `greptile-review-2026-08-23.pdf` | An automated code review |
| `build-greptile-report.py` | The script that made it |

### `public/`

| File | What it is |
| --- | --- |
| `favicon.ico` | The little icon in the browser tab |
| `robots.txt` | Instructions for search engines |
| `whisper-worker.js` | **The speech-to-text engine**, running in the visitor's browser |
| `images/`, `logos/`, `placeholder.svg` | Pictures served as-is |

`whisper-worker.js` is worth noticing: it is why the sixty-second explanation
costs nothing to transcribe and never leaves the student's computer.

---
# 6. How the project works, end to end

## The shape of every request

Most websites look like this:

```
Browser  →  Server  →  Database  →  Server  →  Browser
```

This one has no middle server:

```
Browser  →  Database  →  Browser
```

The browser talks to Supabase directly. What stops a student reading another
student's marks is not a server checking — it is a rule inside the database that
runs on every single query.

When something needs the outside world (the AI, an email), a third shape appears:

```
Browser  →  Edge function  →  DeepSeek  →  Edge function  →  Database  →  Browser
```

---

## Story 1: a college imports its students

**Step 1.** The TPO signs in and opens Students. Their browser asks the database
for students. The database checks: *does this person own a college, and is this
student in it?* Only matching rows come back. A different college's students are
not filtered out by the website — they are never sent.

**Step 2.** The TPO picks a branch and chooses a CSV file. **The file is read
inside the browser.** It is not uploaded anywhere yet.

**Step 3.** The browser checks every row: name, email, valid email shape, not
already registered, not repeated. A `section` column, if present, is joined to
the branch — `CSE` + `A` becomes cohort `CSE-A`.

**Step 4.** The TPO sees the summary — how many valid, duplicate, invalid — and
presses confirm.

**Step 5.** The valid rows go to the `create-student-users` edge function. This
one needs the *secret* key, which is why it cannot happen in the browser: only
that key can create accounts.

**Step 6.** The function creates each account and sends an invitation email.

**Step 7.** A second call sets each student's cohort.

**Step 8.** The browser shows what happened to every row, with failures
downloadable as a CSV.

```
TPO's browser ──reads and checks the file locally
      │
      ├──→ create-student-users (edge function, secret key)
      │         └──→ creates accounts, sends emails
      └──→ tpo_set_cohorts (database function)
                └──→ CSE-A, CSE-B recorded
```

---

## Story 2: a student's daily task

**Step 1 — during the night.** A timer inside the database (`pg_cron`) runs at
00:10. For each active student it calls `create_lot_for(student, today)`.

**Step 2 — choosing the topic.** `next_lot_level()` decides. In order:

1. Is there a planned step for this week? Use it.
2. Otherwise, take the lowest un-cleared step within the student's unlock limit.
3. Where several topics sit at that same step, **pick the one the student is
   weakest at**, using their hidden per-topic rating.

Rule three is the adaptive part. A student with no ratings yet gets exactly what
they would have got before — the rating only breaks ties.

**Step 3 — the task text.** If no task has ever been written for that topic, the
`lot-writer` edge function writes one, using a real posted job description if one
exists. It is then cached and shared by every student who reaches that topic.

**Step 4 — morning.** The student opens the site and sees one card.

**Step 5 — doing it.** They build the thing and submit a link or a file.

**Step 6 — explaining it.** They record sixty seconds. `whisper-worker.js` turns
it into text **in their own browser** — no upload, no cost.

**Step 7 — checking.** Several functions run: was it really their work
(`github-check`), does it look AI-written (`ai-authorship`), is it similar to
someone else's (`moss-check`), how good was the explanation (`voice-score`).

**Step 8 — questions.** `question-generator` writes questions *from their own
submission*, which are much harder to fake than generic ones.

**Step 9 — the score.** Recorded against the student. Their topic rating moves:
+25 for correct, +12 if they used a hint, −8 if wrong. If the marking itself
failed, **nothing moves** — a broken checker must never count as a wrong answer.

**Step 10 — the squad.** Their points feed their squad's weekly total.

**Step 11 — tomorrow.** The next task is chosen using the updated picture.

---

## Story 3: a season plays itself out

The season runs on its own. Every week, `run_all_seasons()` does three things in
order: score the week that just ended, let the season advance, and close it if
the last week has passed.

`advance_season()` looks at which phase the current week falls in and builds what
that phase needs:

| Weeks | Phase | What gets built |
| --- | --- | --- |
| 1–2 | Foundation | (squad formation happens here) |
| 3–6 | League | A round robin **inside each section** |
| 7–9 | Championship | Top two per section qualify; they play each other |
| 10 | Seeding | The qualified are ranked |
| 11 | Knockout | Seed 1 v 4, seed 2 v 3 |
| 12 | Final | The two winners |

**When a squad fails to qualify**, one column changes: `qualified = false`.
Nothing in the daily engine reads that column. Their tasks keep coming, their
scores keep counting, their leaderboard places stand, and every individual award
stays winnable. This was tested: 146 students in knocked-out squads went on to
score 44,160 points in the weeks afterwards, and three of the top four students
overall came from squads that were out of the race.

---

## Story 4: a recruiter hires

**Step 1.** The recruiter signs up and gives their company name. They start
unverified and see **nothing**.

**Step 2.** An administrator approves them on Admin → Recruiters.

**Step 3.** They search Talent — by role, skill, activity, consistency.

**Step 4.** Only students who **chose** to be discoverable appear. A student must
be active, have profile visibility public, *and* have switched their portfolio to
Public. Three separate opt-ins.

**Step 5.** They open a proof profile: verified skills, projects with evidence,
assessment scores, daily performance, playable sixty-second explanations,
consistency, streaks.

**Step 6.** They shortlist, optionally set sponsored work, and record the
outcome.

---

# 7. How to install and run the project

## 1. Prerequisites

| You need | Why | Where |
| --- | --- | --- |
| **Node.js 18 or newer** | Runs the build tools | nodejs.org |
| **Git** | Downloads the code and tracks changes | git-scm.com |
| A code editor | VS Code is the common choice | code.visualstudio.com |

Check they are installed:

```sh
node --version     # expect v18 or higher
git --version
```

**You do not need:** a database, an AI key, or a `.env` file. The project
connects to a Supabase project that already exists.

## 2. Download the project

```sh
git clone https://github.com/manitejakanuri1/prooflaab.git
cd prooflaab
```

*Clone means: make your own copy of the code, with its full history.*

## 3. Install dependencies

```sh
npm install
```

*Dependencies are code other people wrote that this project uses.* This
downloads a few hundred megabytes into a folder called `node_modules`. It takes
a minute or two and only needs doing once. Never edit anything inside
`node_modules`, and never commit it — `.gitignore` already excludes it.

## 4. Environment variables

**None needed.** The Supabase address and its *publishable* key are written
directly into `src/integrations/supabase/client.ts`.

There is a `.env.example` file, but it is left over and out of date. Ignore it.

> **The one rule about secrets:** the publishable key is safe to be public. The
> *service role* key is not — it bypasses every security rule. It lives only in
> the Supabase dashboard settings for edge functions. It must never appear in
> any file in this repository.

## 5. Run it

```sh
npm run dev
```

Open **http://localhost:8080**. You should see the ProofLabAI front page.

Other useful commands:

```sh
npm run typecheck    # check the code for mistakes
npm run build        # typecheck, then package for the internet
npm run lint         # check code style
```

### With Docker instead

```sh
docker compose up
```

Same address. Slower to start, but identical on every machine.

## 6. Common problems

**"command not found: npm"** — Node.js is not installed, or the terminal was
open before you installed it. Install Node, then open a new terminal.

**Port 8080 is already in use** — something else is using it. Stop that program,
or change the port in `vite.config.ts`.

**A blank white page** — open the browser console (F12) and read the red text.
Usually a component crashed. `ErrorBoundary.tsx` normally catches this and shows
the reason.

**"Failed to fetch" everywhere** — no internet, or the Supabase project is
paused. A free Supabase project pauses after a period of inactivity; open the
dashboard and resume it.

**Signing in gets you nowhere** — the account probably has no role row. Look at
`RoleBasedProtectedRoute.tsx`, which handles that case.

**It compiles but a screen is empty** — remember `strict: false`. TypeScript
cannot see the database. A renamed column compiles perfectly and returns nothing.
Check the browser console for the actual database error.

---

# 8. How to use the project

Live at **https://prooflaab.vercel.app**

## If you are a student

1. **Sign in** with the invitation your college emailed you.
2. **Finish setup** — upload your resume, or skip and pick your interests.
3. **Daily Card** is your home. One task. Read it, build it, submit it.
4. **Record your explanation** — press record and talk for sixty seconds about
   what you built and why.
5. **Answer the follow-up questions**, written from your own submission.
6. **Squad** shows your team, the standings, and the leaderboards.
7. **Profile** holds your portfolio. **To be visible to recruiters you must
   switch your portfolio to Public** — nothing happens until you do.

## If you are a college (TPO)

1. **Sign in** and land on Home.
2. **Students → Import** — upload your CSV. Include a `section` column so each
   section gets its own league.
3. **Squads → Manage → Form squads.** Squads of eleven are created, balanced by
   ability. Anything that does not divide by eleven waits for you.
4. **Squads → Assign** — place the leftover students, or create a squad by hand.
5. **Standings** — each section has its own table.
6. **Insights** — who is moving and who has gone quiet.
7. **Post a job description** so daily tasks are written from real hiring needs.

## If you are a recruiter

1. **Sign up** and give your company name.
2. **Wait for approval.** You will see nothing until an administrator approves
   you. This is deliberate.
3. **Talent** — search and filter.
4. **Open a profile** — the evidence, including playable explanations.
5. **Shortlist**, set sponsored work, record outcomes.

## If you are an administrator

1. **Overview** — the whole platform at a glance.
2. **Recruiters** — approve or remove approval. *Do this first, or no recruiter
   can work.*
3. **Users** — students, colleges, startups.
4. **Proof Review** — flagged submissions.
5. **Assign Tasks**, **Content**, **Analytics**, **Token Usage**, **Security
   Events**, **System Settings**.

> **If a screen looks empty on a brand-new college, it is probably correct.**
> Leaderboards, awards and the recruiter's talent list all need students to have
> done work first.

---

# 9. How to modify or extend the project

## Where things go

| To change… | Edit |
| --- | --- |
| Colours, fonts, spacing | `tailwind.config.ts` and `src/index.css` |
| Text on a screen | The component in `src/components/…` |
| A whole new page | Add to `src/pages/`, then register in `src/App.tsx` |
| A new dashboard screen | Add to the right family, then wire into that dashboard's sidebar and switch |
| Data fetching | A new hook in `src/hooks/` |
| A database change | **A new migration file** — never edit an old one |
| Something needing AI | A new folder in `supabase/functions/` |

## Adding a new page

1. Create `src/pages/MyPage.tsx` exporting a component.
2. In `App.tsx`, import it lazily and add a `<Route>`.
3. If it should be private, wrap it in `RoleBasedProtectedRoute`.

## Adding a screen to a dashboard — worked example

Say you want an "Attendance" screen for the college.

1. Create `src/components/dashboard/college/TpoAttendance.tsx`.
2. Open `CollegeDashboardSidebar.tsx` and add a menu entry with a new id.
3. Open `CollegeDashboardContent.tsx` and add a `case` for that id.

That is the same three-step pattern used by every existing screen.

## Adding a database function

1. Write the SQL.
2. Apply it through the Supabase tools — **never `supabase db push`**.
3. Save the identical SQL as a new file in `supabase/migrations/`.
4. Regenerate `src/integrations/supabase/types.ts`.
5. Commit both.

Steps 3 and 4 are the ones people forget, and both cause confusing problems
later.

## Things to be careful about

- **Never edit an applied migration.** Write a new one.
- **Never commit the service role key.** It bypasses every security rule.
- **The database is shared.** Two people work on one live database. A change on
  one machine affects the other immediately. Two admin screens broke exactly this
  way on 7 September 2026.
- **Compiling proves nothing.** `strict: false` means TypeScript cannot see the
  database. Click the screen.
- **Never average per-topic ratings** into a single score. This is the
  specification's highest-priority rule, and the tempting place to break it is a
  leaderboard that wants "one number".
- **Do not delete** `package.json`, the `tsconfig` files, `vite.config.ts`,
  `vercel.json`, or anything in `supabase/migrations/`.

## Two extension ideas

**A screen for the placement test.** The database side already works —
`placement_questions()` returns 6–8 questions and `submit_placement()` records
the answers. What is missing is a screen. You would add a component under
`src/components/onboarding/`, call those two functions, and show it after a
student picks their interests. No database work needed.

**Questions using the five new answer types.** `check_answer()` already marks
select-all, matching, ordering, assertion-reason and fill-in-the-blank. Nothing
generates questions that use them. You would change the AI prompt in the
question-generating function to produce them, and add the matching input
controls in the browser.

---

# 10. Codebase summary

| Area | Files | Purpose |
| --- | --- | --- |
| `src/App.tsx` | 1 | The map of every address and who may reach it |
| `src/main.tsx` | 1 | The first line of code that runs |
| `src/pages/` | 23 | One file per web address |
| `src/components/ui/` | 32 | Buttons, dialogs, tables — the vocabulary |
| `src/components/dashboard/student/` | 38 | The student's screens |
| `src/components/dashboard/college/` | 23 | The college's screens |
| `src/components/dashboard/admin/` | 25 | The administrator's screens |
| `src/components/dashboard/startup/` | 12 | The company's screens |
| `src/components/dashboard/recruiter/` | 3 | The recruiter's screens |
| `src/components/dashboard/season/` | 2 | Season bar and leaderboards, shared |
| `src/components/dashboard/assignTasks/` | 2 | One assign screen, used by two roles |
| `src/components/auth/` | 5 | Sign in, sign up, email confirmation |
| `src/components/onboarding/` | 8 | First-time setup wizards |
| `src/hooks/` | 33 | Fetching and sharing data |
| `src/lib/` | 13 | PDF reading, speech-to-text, helpers |
| `src/contexts/AuthContext.tsx` | 1 | Who is signed in |
| `src/integrations/supabase/` | 2 | The database connection and its type map |
| `src/recruiter/` | 2 | The recruiter data layer |
| `supabase/migrations/` | 86 | The database's complete history |
| `supabase/functions/` | 38 | Cloud programs: AI, email, code execution |
| `docs/` | 8 | Design documents |
| `public/` | 9 | Files served as-is, including speech-to-text |
| Root config | ~20 | Build, style, hosting, Docker settings |

### The ten files that matter most

| File | Why |
| --- | --- |
| `src/App.tsx` | Every address and every permission |
| `src/integrations/supabase/client.ts` | The one connection to the data |
| `src/components/RoleBasedProtectedRoute.tsx` | Who may see what |
| `src/components/dashboard/student/StudentDailyCard.tsx` | The daily task |
| `src/components/dashboard/college/TpoImportStudents.tsx` | How students get in |
| `src/components/dashboard/college/TpoSquads.tsx` | The college's control panel |
| `src/components/dashboard/recruiter/ProofProfile.tsx` | The output of the whole product |
| `supabase/migrations/…stage25_daily_lot_engine.sql` | The core engine |
| `supabase/migrations/…stage50_league…sql` | The competition |
| `supabase/functions/lot-writer/index.ts` | Where the AI writes the work |

---

# 11. Glossary

**API** — A way for two programs to talk. Like a waiter: you ask for something,
it goes away and brings it back.

**Backend** — The part you cannot see: storage and logic. Here, mostly the
database itself.

**Bug** — A mistake in code that makes it behave wrongly.

**Cache** — Keeping a copy of something so you do not have to fetch it again.

**Cohort** — Here, an academic section like CSE-A. The group squads are made
inside.

**Commit** — One saved change in the project's history, with a note about why.

**Component** — A reusable block of screen. A button, a table, a whole page.

**CSV** — A simple spreadsheet file where values are separated by commas.

**Database** — An organised store of information. Think of a filing cabinet
where every drawer has strict rules.

**Dependency** — Code somebody else wrote that this project uses.

**Deploy** — Putting the website onto the internet.

**Edge function** — A small program that runs in the cloud only when called.

**Environment variable** — A setting kept outside the code, usually secret.

**Frontend** — Everything inside your browser: what you see and click.

**Function** (in a database) — A small program stored in the database itself.

**Git / GitHub** — Git records every change. GitHub stores that history online.

**Hook** — In React, reusable logic several screens can share.

**Lot** — This project's word for one day's task.

**Migration** — One numbered file describing one change to the database.

**Postgres / PostgreSQL** — The specific database used here.

**Repository (repo)** — The project folder, with its full history.

**RLS (Row Level Security)** — Rules inside the database deciding who may see
which rows. The main thing protecting the data.

**Route** — A web address, and the page it shows.

**Schema** — The shape of the database: the tables and their columns.

**Seed** — A starting value, before real evidence exists.

**Service role key** — A master key that bypasses every security rule. Must
never be in this repository.

**SQL** — The language for talking to a database.

**Squad** — A team of eleven students who compete together.

**Supabase** — The company providing the database, login and storage.

**TPO** — Training and Placement Officer: the college staff member who gets
students hired.

**TypeScript** — JavaScript with a spell-checker for code.

**Vercel** — The company hosting the website.

---

# 12. Questions beginners ask

**What should I know before trying to understand this?**
Enough to read basic JavaScript, and roughly what a website and a database are.
You do not need to know React or SQL — but you will pick up both here, because
this project uses SQL far more heavily than most.

**Can I run it without installing anything?**
Yes — just visit prooflaab.vercel.app. To run it on your own computer you need
Node.js.

**Do I need an API key or a database?**
No. It connects to a Supabase project that already exists. There is nothing to
set up.

**Is it safe that a key is written in `client.ts`?**
Yes. That is the *publishable* key, designed to be visible. It identifies the
project but grants nothing. Row Level Security is what protects the data.

**What happens if I delete a file?**
Depends. Delete a component and the screens using it break — the error will tell
you where. Delete a migration and you break the database's history, which is much
worse. Git can restore anything: `git checkout -- path/to/file`.

**How do I change the colours or the name?**
Colours: `tailwind.config.ts` and `src/index.css`. The name in the browser tab:
`index.html`. The logo: `src/assets/`.

**How do I put it on the internet?**
It is already there. Pushing to `main` on GitHub makes Vercel rebuild and
publish automatically. Edge functions deploy separately with
`supabase functions deploy <name>`.

**Why is so much logic in SQL instead of JavaScript?**
Cost and safety. A server running all day costs money all day. And a rule inside
the database cannot be bypassed by a bug in the website. The trade-off is that
you must read SQL to understand the system.

**The code compiles but the screen is empty. Why?**
Almost certainly a database issue, not a code issue. `strict: false` means
TypeScript cannot check column names. Open the browser console and read the real
error.

**Something worked yesterday and is broken today, and I changed nothing.**
Two people share one live database. Someone else may have changed it. This has
happened twice. Check with the other person before debugging your own code.

---

# 13. Final notes and next steps

## You can understand this

This project is large — 433 files and 83,000 lines — but it is not complicated
everywhere. Most of those files are one screen doing one job. The genuinely
interesting parts are perhaps fifteen files, and this book has pointed at all of
them.

The fastest way in is not to read code top to bottom. It is to pick one thing a
user does — importing students, say — and follow it all the way through: the
screen, the function it calls, the database rule that lets it happen. Do that
three times and the shape of the whole thing appears.

## What to learn next, in order

1. **Basic JavaScript** — variables, functions, arrays. Everything else builds
   on it.
2. **What an API is** — one program asking another for something.
3. **React basics** — components, props, state. The official tutorial is good.
4. **Basic SQL** — `SELECT`, `INSERT`, `WHERE`. More important here than in most
   projects.
5. **Row Level Security** — the idea that the database decides who sees what.
   This is the concept that makes this project's architecture make sense.

## Small tasks to practise on

**Easy**
- Change a heading and watch it update while the site is running.
- Change the primary colour in `tailwind.config.ts`.
- Add a row to a table on a screen you like.

**Medium**
- Add a new page and route it in `App.tsx`.
- Write a hook that fetches something and shows it.
- Read three migration files and explain what each fixed.

**Harder**
- Build the placement-test screen. The database side already works.
- Add one of the five unused answer types end to end.
- Follow a daily task from `pg_cron` to the student's screen and write down
  every file it passes through.

## Last thing

The most valuable habit in this codebase is already visible in it: **every
migration explains, in plain English, what problem it was solving.** Not what the
code does — you can read that — but *why it exists*. Several bugs in this project
were found by reading those notes rather than the code.

When you add something, write that note. The person who needs it most is you, in
three months, having forgotten everything.

---

*End of book. Written 8 September 2026 from commit `077fe5a`.*
