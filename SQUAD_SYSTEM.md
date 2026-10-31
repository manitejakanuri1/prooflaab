# The Squad System

How the learning league actually works, and where each part of it lives in the
code. This follows the Squad System Blueprint; where the two differ, this file
is what is built and the blueprint is what was asked for. The differences are
marked.

Built in stages 49–54. Nothing here is theoretical: a twelve-week season with
three cohorts and 212 students was simulated against the live database before
any of it was committed, and the squad sizes were re-simulated with four
sections of 77, 70, 65 and 8 after the owner settled on elevens.

---

## The shape of it

```
College
   └── Cohort            CSE-A, CSE-B, CSE-C — the academic section
         └── Squad       11 students, with a twelfth seat kept free
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
- **A squad is eleven students.** The count is `students / 11`, rounded down, plus one more squad when 5 or more are left over (migration 195; before, fewer than eleven left over waited in Reserve).
- **Whatever is left over is not placed.** It waits in the reserve pool for the
  college to decide. The platform does not spread a remainder around to make
  uneven squads, and it does not invent a short squad.
- Students are ranked by experience and dealt out in a **snake** — 1,2,3,3,2,1 —
  so no squad collects all the strongest students. The remainder is therefore
  the least experienced tail of the section, which is worth knowing when
  deciding where to put them.
- Every squad is created with **twelve seats and eleven members**. The spare
  seat exists so a college can place a leftover student without having to raise
  the limit first.

| Cohort size | Squads drawn | Left for the college |
| --- | --- | --- |
| 77 | 7 × 11 | 0 |
| 70 | 6 × 11 | 4 |
| 65 | 5 × 11 | 10 |
| 8 | none | 8 |

This is a deliberate decision by the project owner, taken over the alternative
of filling every squad to a 10–12 band. Who plays and who waits is a judgement
about real students, and it belongs to the person who knows them.

**What the college can do with the remainder**, all from College → Squads:

| | |
| --- | --- |
| Assign | Put a student into any squad with a free seat. Reserves are listed with their section so it is obvious which league they belong in. |
| Manage → Create squad | Make a squad by hand — for a section too small to draw one, or when the leftovers deserve their own squad. Starts empty with twelve seats. |
| Manage → Rebalance | Drops every unplaced student into the emptiest squad of their own section that has room. One button instead of one at a time. |
| Do nothing | A student can sit out the league and still get their daily Lot, their score and every individual award. |

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

## One season per year group (owner rules, 31 Oct 2026 - replaces "Joining and the school year")

- **Year group.** A student's batch ("2nd year", "2023-2027", "2027") becomes `student_profiles.passing_out_year`
  (migration 183). Screens show it as "2nd year" (`year_group_label`). Only 4-year (B.Tech) courses for now.
- **One season per year group, side by side** (migration 184). `seasons.year_group` = passing-out year;
  `ensure_season(college, year_group)`; at most one running season per year group (index from 185).
- **Squads form on any day.** Any import or the nightly job seats waiting students at once
  (`form_squads` -> `form_squads_in(season)`). A late student takes a free seat in a squad of their own
  section, else waits in Reserve; 5 waiting make a new squad (migration 195; was 11). A late section joins the running season and
  gets fixtures for the league weeks left (`extend_fixtures`).
- **Season shape (plan_version 2, 12 weeks):** league weeks 1-10 inside each section (odd count: one squad
  rests each week), semi-finals week 11, final week 12. Old seasons keep plan_version 1 and the old shape.
- **A champion in every section** (`generate_section_knockout`, `generate_section_finals`, `season_champions`):

  | Squads in the section | What happens |
  |---|---|
  | 1 | No champion |
  | 2 | Final: seed 1 v seed 2 |
  | 3 | Seed 1 waits in the final; semi-final 2 v 3 |
  | 4 or more | Semi-finals 1 v 4 and 2 v 3, then the final (only the top 4 go through) |

  Seeds = league rank (points, wins, head-to-head). A drawn semi-final or final goes to the higher seed.
  No champion in a section that never played a league match.
- **Pooled sections (optional).** The college ticks sections (`seasons.cross_sections`, `tpo_season_options`);
  the best 4 of the pool play one semi-final round and final ("Cross-section" champion) instead of their own.
  Can be changed only before week 11.
- **Back to back, with 3 days off.** When a season closes, its year group has 3 days off (`season_gap`;
  5 minutes in PRAGATI's fast test season): no Daily Lot (`create_lot_for` answers "between seasons"),
  roadmap only. Then the next season opens (nightly job or any import) with the same squads, points from 0
  (`carry_over_squads`, same year group). There is no 1 June reset.
- **Make fresh squads.** The college can ask for new squads next season (`seasons.fresh_squads_next`,
  undoable until the next season opens); the next season then deals everyone again.
- **College screens follow a picked year group** (`colleges.viewing_year_group`, `tpo_pick_year_group`,
  `tpo_year_groups`, `my_year_group`); every function that uses `my_season_id()` follows it. Students always
  see their own year group.
- Check: `scripts/dev-tools/season_year_group_check.sql` (23 checks, rolls back).

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
which stage and week each fixture belongs to. Assign lists every unplaced
student with their section. Manage carries Form squads, Rebalance and Create
squad. A Leaderboards tab shows the individual side.

---

## Added after this document was first written (26 Oct 2026)

- **Per-topic rating.** Quiz results were recorded per topic since stage 68. Migration 146 adds graded daily Lots and shows
  each student labels ("strong in", "needs work") in Build-log, Skills. It records and displays only; it does not choose Lots.
- **A college chooses how many squads qualify.** Migration 144: Squads, Manage, "Squads that qualify" (1 to 8 per section;
  the default stays 2 per section, 4 for a single section). It applies the next time squads are ranked.
- **Moving a student between sections.** Migration 145: the student's profile has a Section control. A squad plays inside
  one section, so a seat in a squad of a different section is released and the student waits in the reserve pool.

## Not built

- **Capability balancing on anything but experience.** The snake draft ranks by `total_xp` then `trust_score`. A
  calibration score would be a better input once one exists for every student.
- **Per-topic rating choosing the daily Lot.** The rating is recorded and shown, but `next_lot_pick` still uses recent Lot results only.
