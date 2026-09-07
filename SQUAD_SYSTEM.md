# The Squad System

How the learning league actually works, and where each part of it lives in the
code. This follows the Squad System Blueprint; where the two differ, this file
is what is built and the blueprint is what was asked for. The differences are
marked.

Built in stages 49–53. Nothing here is theoretical: a twelve-week season with
three cohorts and 212 students was simulated against the live database before
any of it was committed.

---

## The shape of it

```
College
   └── Cohort            CSE-A, CSE-B, CSE-C — the academic section
         └── Squad       10–12 students, 11 preferred
               └── Student   one Lot a day, six days a week
```

A student's score from their daily Lot adds into their squad's score. Squads
play a league inside their own cohort. The best of each cohort meet across
cohorts, and one of them wins the season.

---

## Squad formation

`form_squads(college_id)` — called by the TPO's **Generate squads** button
(`tpo_form_squads`) or by the nightly job.

- Students are grouped by `student_profiles.cohort`, which falls back to
  `branch` when a college supplies no sections.
- Squad count is `round(students / 11)`, taking one more squad only when that
  keeps every squad at ten or more.
- Everyone is placed. There is no reserve pool: the old code built only whole
  squads of exactly eleven and left the remainder as spectators.
- Students are ranked by experience and dealt out in a **snake** — 1,2,3,3,2,1 —
  so no squad collects all the strongest students.

Checked against the blueprint's own examples:

| Cohort size | Squads | Sizes | Blueprint says |
| --- | --- | --- | --- |
| 77 | 7 | 11 × 7 | 7 × 11 ✔ |
| 65 | 6 | 10, 11 × 5 | 11,11,11,11,11,10 ✔ |
| 80 | 7 | 11–12 | 7 of 11–12 ✔ |
| 70 | 6 | 11–12 | 7 × 10 — **differs** |

The 70 case is the one difference. Both answers sit inside the blueprint's
10–12 band; six squads of 11–12 is closer to its own stated preferred size of
eleven than seven squads of ten.

Sizes the band cannot hold — 13 students, or 25 — get the closest thing to it:
one squad of 13, or 12 and 13. Three squads of eight would be further from
eleven, not nearer. `max_members` is set to the squad's real size so the Manage
screen does not read a full squad as over-full.

---

## The season

Twelve weeks by default, fifteen at most, in named phases. `season_plan()`
returns the calendar and `season_phase()` names any single week; both derive
from `planned_weeks`, so a fifteen-week season stretches the league and the
championship rather than inventing a new shape.

```
   weeks 1–2    foundation      calibration and squad formation
   weeks 3–6    league          round robin inside each cohort
   weeks 7–9    championship    inter-cohort, qualified squads only
   week  10     seeding         the qualified are ranked
   week  11     knockout        seed 1 v 4, seed 2 v 3
   week  12     final           the two winners
```

For fifteen weeks: foundation 1–2, league 3–8, championship 9–12, then seeding,
knockout and final.

`advance_season()` looks at the phase and builds whatever that phase needs. It
is called every week by `run_all_seasons()`, after the previous week has been
scored, so each stage is drawn from settled results.

| Phase | What is built |
| --- | --- |
| league | `generate_cohort_league` — one round robin per cohort |
| championship | `qualify_squads` then `generate_championship` |
| seeding | `seed_championship` |
| knockout | `generate_knockout` |
| final | `generate_final` |

An odd number of squads in a cohort means one BYE per round. A BYE is not a
week off: the students still get their Lots and still score. It only means
their squad has no opponent that week.

---

## Qualification, and the rule that matters most

Top **two squads per cohort** go through. A college running a single cohort
sends its top four instead, because a two-squad championship is not a
championship.

When a squad does not qualify, `squads.qualified` becomes false and **that is
the entire consequence**. Nothing in the daily engine reads that column:

- daily Lots keep arriving
- individual scores keep being recorded
- the individual leaderboards keep including them
- every individual award stays winnable

Proven in the simulation: the 146 students in the 13 knocked-out squads scored
44,160 points across weeks 7–12, and three of the top four students on the
season's overall leaderboard came from squads that were out of the race.

---

## Two scoreboards

| Championship | Individual |
| --- | --- |
| squad-based | student-based |
| can end for a squad | never ends for anyone |
| ends with a Season Champion | ends with individual awards |

`season_leaderboard(kind)` serves six tables:

| Kind | Meaning |
| --- | --- |
| overall | every point scored this season |
| weekly | points in the most recent scored week |
| growth | average of the last three weeks minus the first three |
| consistency | weeks scored at 80% or more of that student's own best |
| participation | weeks in which anything was scored |
| skill | best assessed score in a single skill |

`season_awards()` returns the seven pieces of recognition: Orange Cap, Purple
Cap, Player of the Week, Most Improved, Consistency Award, Squad MVP (the
biggest contributor in the champion squad) and Rising Star (the best season
total among students whose opening week was in the bottom half).

Squad achievements gain Championship Qualifier, Finalist and Season Champion
through `squad_championship_achievements()`.

---

## Where a cohort comes from

The import screen reads a `section` column — also accepted as `sec`, `class`,
`division` or `cohort` — and joins it to the branch chosen for the file, so
`CSE` plus `A` becomes the cohort `CSE-A`. A file with no section column leaves
the whole branch as one cohort, which is exactly how it behaved before sections
existed.

The account-creating edge function has no cohort argument, so the import sets
cohorts in a second call, `tpo_set_cohorts`, scoped to the caller's own
college. A trigger also fills `cohort` from `branch` on any insert that leaves
it null, so a student created by any other route still lands in a cohort and
never falls out of squad formation.

---

## What the screens show

**Student → Squad.** The season phase bar across the top, the squad's cohort
next to its member count, and — once the league is over — either "Through to
the championship as seed N" or the plain statement that the championship race
is over and everything else continues. Standings are the cohort's, not the
whole college's. A Leaderboards tab carries all six tables with the student's
own row highlighted.

**College → Squads.** The same phase bar. Standings gain a Cohort column, a
position that counts within the cohort, and a Championship column. Matches show
which stage and week each fixture belongs to. A Leaderboards tab shows the
individual side.

---

## Not built

- **Per-topic Elo rating** replacing the fixed 146-step ladder. This is the
  Master Specification's own core idea and is a separate piece of work; it is
  the one change that could break student progression if done carelessly.
- **Capability balancing on anything but experience.** The snake draft ranks by
  `total_xp` then `trust_score`. A calibration score would be a better input
  once one exists for every student.
- **A TPO control to change how many squads qualify.** Two per cohort (four for
  a single cohort) is currently fixed in `qualify_squads`.
