                     ProofLabAI
         College / TPO Dashboard

                                Detailed UI/UX Flow & Developer Specification

                                                           Version 1.0

  Final navigation: HOME · STUDENTS · SQUADS · INSIGHTS
This document translates the simplified TPO dashboard into a practical end-to-end product flow. The goal
is to keep the TPO experience simple while preserving the operational capabilities required by the
ProofLabAI college pilot.

ProofLabAI -- College / TPO Dashboard  Page 1
1. UX Philosophy

The TPO dashboard is an action dashboard, not a collection of administrative modules. The TPO should
understand what is happening quickly and move directly to the student, squad, or issue that needs
attention.

Section          Mental model          Primary question

Home             See                   What is happening now?

Students         Manage                What is happening with my students?

Squads           Compete               How are my squads performing?

Insights         Act                   Where should I intervene?

Navigation rule: CSV import, onboarding, reserve pool, leaderboard, season, inactive students, and
reports are capabilities inside these four destinations. They are not separate sidebar sections.

2. HOME -- See

Home is the default TPO landing page. It answers: "What needs my attention?"

Example context

Pragati Engineering College · CSE · 70 students · 6 full squads · 4 reserves.

Area                  Example                            Action
Students              70 total · 61 active this week     Open Students
Today                 52 active today                    View activity
Needs attention       9 students                         View filtered list
Squads                6 squads                           Open Squads
Season                Week 7 / 10                        View season
Leaderboard           Titans #1 · 920 pts                Open squad

Real-time example

On Monday morning the TPO logs in and sees: 9 students need attention. The breakdown is 4 incomplete
onboarding records, 3 students who have not submitted the current Lot, and 2 students with low recent
activity.

The TPO taps 3 students haven't submitted this week's Lot. The system opens Students with the correct
filter already applied. The TPO does not have to search again.

Quick actions

· Import Students -- start CSV import.

· View Students -- open student list.

· View Squads -- open squad standings.

· View Attention -- open pre-filtered students.

Developer rule: Home cards are clickable only when a useful drill-down exists. Static metrics should look
like information, not buttons.

3. STUDENTS -- Manage

ProofLabAI -- College / TPO Dashboard                                          Page 2
Students is the single workspace for importing, onboarding, searching, filtering, reviewing, and acting on
student records.

Students landing view

Control                                Purpose
Search                                 Name, roll number, email
Branch                                 Filter by branch
Year                                   Filter by year
Squad                                  Filter by assigned squad or Reserve
Status                                 Active / Needs attention / Inactive / Unassigned
Import Students                        Upload college CSV

Example list

Student                                Roll No.  Branch            Squad                 Status
Priya Verma                            23CSE041  CSE               Titans                Active
Hasini Rao                             23CSE052  CSE               Titans                Active
Rahul Kumar                            23CSE067  CSE               Reserve               Needs attention
Arjun Reddy                            23CSE071  CSE               Intellects            Inactive

3.1 Import Students

Step             System behavior

1. Select CSV    TPO uploads the college student file.

2. Validate      Check headers, required fields, duplicates, invalid rows.

3. Preview       Show total, valid, invalid and duplicate counts.

4. Fix errors    Download error report and correct the file.

5. Import        Create/update eligible student records.

6. Invite        Trigger configured onboarding notifications.

Example: 70 rows uploaded  66 valid  2 duplicates  2 missing emails. The TPO fixes the two rows,
uploads again, and completes the import.

3.2 Student Profile

Selecting Priya opens: Priya Verma · CSE · 23CSE041 · Titans. Show onboarding status, activity, recency,
current score, tasks completed, voice explanations, skills, and recent work. The TPO's goal is to answer: Is
this student participating and improving?

3.3 Needs Attention

Needs Attention is a filter, not a navigation section. Example: Status  Needs attention. Rahul appears
with No activity for 8 days. The TPO can open the student and choose Send reminder or another
configured intervention.

4. SQUADS -- Compete

ProofLabAI -- College / TPO Dashboard                                                             Page 3
Squads is one destination containing the competition views. Each full squad contains 11 active members;
remaining eligible students can remain in Reserve.

Internal views

View                                   Question answered
Standings                              Who is leading?
Overview                               How is this squad doing?
Members                                Who is in the squad?
Matches                                Who are we playing?
Assign                                 Where should a reserve student go?

4.1 Standings

Rank       Squad                       Played            Won               Lost          Points

1          Titans                      5                 4                 1             920

2          Intellects                  5                 3                 2             887

3          Strikers                    5                 3                 2             850

TPO taps Titans  Squad Overview.

4.2 Squad Overview

Show squad name, 11 members, rank, points, record, participation, next match, and squad pulse.
Example: Titans · Rank #1 · 920 points · 4­1 · 10/11 active. If one member needs attention, make that
signal actionable.

4.3 Members

Show the 11 members with name, activity, contribution, and status. Selecting a member opens the
canonical Student Profile. Do not duplicate the entire Students module here.

4.4 Reserve / Assign

Reserve is a state inside Squads. Example: 4 reserve students are available. TPO selects Reserve  Rahul
 Assign to Squad  Titans  Next Monday  Confirm. The system updates membership and records the
change in the audit log.

4.5 Matches

Show current, upcoming, and previous round-robin fixtures. Example: Titans vs Intellects · Friday · Round
6. Selecting the matchup opens the scoreboard and result details.

5. INSIGHTS -- Act

Insights turns college data into decisions. It should answer: Where should I intervene?

Group                  Example                                             Action
Participation          87% active this week                                View students
Skills                 31 students need SQL improvement                    View affected students
Squad health           Strikers need attention                             Open squad
Season                 Titans #1, Week 7/10                                View season
Reports                Weekly management summary                           Export

ProofLabAI -- College / TPO Dashboard                                                                  Page 4
5.1 Participation

Example: 87% active this week, down 4% from last week. Tap the metric to see which students caused the
decline.

5.2 Skill gaps

Example: SQL -- 31 students need improvement. Tap  affected students  optionally filter by branch,
year, or squad.

5.3 Squad health

Example: Titans -- Healthy; Intellects -- Healthy; Strikers -- Needs attention. Selecting Strikers opens the
squad overview and shows the members contributing to the signal.

5.4 Season

Example: Season 01 · Week 7/10 · Titans #1 · Intellects +18% improvement. The TPO can inspect
movement without leaving the competition context.

5.5 Reports

Reports and exports are actions inside Insights. Examples: export weekly college summary, student
activity list, squad standings, or season report.

6. Complete Real-World TPO Journey

Monday morning

Home  Needs attention  3 missed Lots  Students filter  Rahul  No activity for 8 days  Send
reminder.

Later that day

Squads  Standings  Titans  Members  identify inactive member.

Reserve action

Squads  Assign  Rahul from Reserve  Titans  Effective next Monday  Confirm.

Sunday review

Insights  Participation  Skill gaps  Squad health  Season  Export weekly report.
  At no point does the TPO need separate pages called Student Import, Onboarding, Reserve Pool,
  Weekly Leaderboard, At-Risk Students, Season, Analytics, or Reports. Those are contextual
  capabilities inside the four destinations.

7. Developer Interaction Rules

· Four top-level destinations only: Home, Students, Squads, Insights.
· Filters instead of pages: branch, year, squad, activity, attention status.
· Tabs inside destinations: Squad Overview, Members, Matches, Standings.
· Drill-downs: metric  affected students  student profile.
· Drawers/modals: Send Reminder, Assign Student, Confirm Import.
· Do not duplicate data: Squad Members should link to the canonical Student Profile.
· Action labels must be explicit: Import Students, View Students, Assign to Squad, Send Reminder, Export
Report.
· Not everything is clickable: only buttons, rows, cards, or clearly styled links should imply interaction.

ProofLabAI -- College / TPO Dashboard  Page 5
· Every alert should lead to action.
· Audit important changes: imports, assignments, status changes, and interventions.

8. Final TPO Navigation

Navigation  Contains                                                   Primary job

HOME        Snapshot, attention, quick actions, squad/season snapshot  See

STUDENTS    List, import, onboarding, filters, profiles                Manage

SQUADS      Standings, overview, members, matches, reserve/assignment Compete

INSIGHTS    Participation, skills, squad health, season, reports       Act

Final UX principle: The TPO should not need to understand ProofLabAI's internal architecture. The
interface exposes four simple destinations and reveals complexity only when the TPO asks for it.

ProofLabAI -- College / TPO Dashboard Detailed Flow v1.0

ProofLabAI -- College / TPO Dashboard                                                              Page 6
