                          ProofLabAI

                                              Master Architecture -- Minimum Navigation
Purpose: Replace a large navigation architecture with a four-section model for each role, while keeping the full squad,
championship, task, evidence, leaderboard and analytics systems underneath.
Product vocabulary: Floor · Lot · Build-log · Squad · Recency · Profile · Talent · Shortlist.
UX principle: Complex system underneath. Simple product on top.

This document supersedes the previous dashboard navigation architecture.

ProofLabAI -- Master Architecture: Minimum Navigation                                                                    Page 1
1. Master Architecture

Role            Primary navigation                                      Design intent
Student         Floor · Build-log · Squad · Profile                     Daily action, personal evidence, team identity, professional identity.
College / TPO   Home · Students · Squads · Insights                     Command center, student operations, squad operations, college intellig
Recruiter       Home · Talent · Shortlist · Lots                        Discover, evaluate, sponsor work, make hiring decisions.

Do not expose backend modules one-for-one. Related features belong inside the closest primary section.

2. Student -- 4 Sections

Section         Purpose                                Inside it
Floor
Build-log       Main home and today's action.          Today's Lot; submit work; 60-second explanation; current Recency; next action.
Squad
Profile         Everything the student has done and provCedo.mpleted Lots; explanations; skills proved; cosigns; history; progress.

                Everything related to their team.      My Squad; standings; members; matches; achievements.

                Professional identity.                 Resume; skills; projects; certifications; proof; privacy; role preference.

3. Student -- Floor

Floor is the default landing page. It answers: "What should I do now?"

Floor

                                                                 

Today's Lot

                                                                 

Submit work

                                                                 

60-second explanation

                                                                 

Evaluation + score

                                                                 

Recency updated

                                                                 

Next action

Do not split Tasks, Submissions, Voice, Scores and History into separate navigation items.

4. Student -- Build-log

Build-log view           What the student sees
Completed Lots           Chronological completed work.
Explanations             60-second explanations and verbal proof.

ProofLabAI -- Master Architecture: Minimum Navigation                                                        Page 2
Build-log view             What the student sees
Skills proved              Skills linked to evidence.
Cosigns                    Peer / mentor / validated evidence.
History                    Activity timeline.
Progress                   Skill and evidence growth.

5. Student -- Squad

Squad view                 What appears
My Squad                   Identity, members, current points, participation.
Standings                  Squad position within the relevant competition.
Members                    Team members and contribution indicators.
Matches                    Round-robin / inter-cohort pairings when applicable.
Achievements               Wins, streaks, milestones and awards.

Important: Squad is cooperative. Do not rank individual students against their own squadmates. Individual recognition can
exist globally or by skill.

6. Student -- Profile

Profile view               Purpose
Resume                     Professional resume.
Skills                     Declared and evidenced skills.
Projects                   Project portfolio.
Certifications             Credentials.
Proof                      Selected professional evidence.
Privacy                    Visibility and sharing controls.
Role preference            Target roles / preferences.

ATS is not a major navigation item; keep ATS-related setup inside Profile/onboarding.

7. TPO -- 4 Sections

Section          Purpose                               Inside it
Home             Command center.                       Students onboarded; active students; attention items; squad status; standings; week
Students         Everything about students.            Import CSV; onboarding; student list; activity; attention; student profile.
Squads           All squad operations.                 Standings; manage; performance; assign; achievements; matches.
Insights         College-level intelligence.           Branch activity; skill gaps; participation; squad trends; risk signals; season results.

8. TPO -- Home             Purpose
                           Coverage.
       Area
       Students onboarded

ProofLabAI -- Master Architecture: Minimum Navigation                                  Page 3
Area                        Purpose
Active students             Current participation.
Students needing attention  Action queue.
Squad status                Current health and competition state.
Current standings           Who is leading.
This week's activity        Participation and completion.

9. TPO -- Students

Students

                                                                 

Import CSV

                                                                 

Onboarding

                                                                 

Student list

                                                                 

Activity / attention

                                                                 

Student profile

CSV Upload is an action inside Students, not a top-level section.

10. TPO -- Squads

Four backend concepts become views inside one Squads section.

View                        Purpose
Standings                   Current cohort / championship ranking.
Manage                      Create, rename, lock, rebalance or archive squads.
Performance                 Daily/weekly score, participation, consistency, trends.
Assign                      Member assignment and controlled reassignment.
Achievements                Squad awards, wins, streaks, milestones.
Matches                     Round-robin and inter-cohort schedule.

TPO  Squads

                                                                 

Choose Cohort

                                                                 

ProofLabAI -- Master Architecture: Minimum Navigation                                Page 4
Choose Squad

                                                                 

Standings | Manage | Performance | Assign

                                                                 

Members | Achievements | Matches

11. TPO -- Insights          Question answered
                             Which cohorts/branches are active?
       Insight               Which skills need attention?
       Branch activity       Where is engagement dropping?
       Skill gaps            Which squads are improving/declining?
       Participation         Who needs support?
       Squad trends          What happened across the championship?
       Student risk signals
       Season results

12. Recruiter -- 4 Sections

Section    Purpose                                     Inside it
Home       Command center.                             New candidates; recommended candidates; recent activity; sponsored Lot status.
Talent     Candidate discovery.                        Role; skills; proof; Recency; squad performance; communication; activity.
Shortlist  Candidates worth acting on.                 Candidate  Proof  Sponsor a Lot.
Lots       Recruiter-created work.                     Create Lot; active Lots; submissions; review; decision.

13. Recruiter Flow

  Talent

                                                                   

  Discover + filter

                                                                   

  Shortlist

                                                                   

  Sponsor a Lot

                                                                   

  Review submission

                                                                   

  Decision / Hire

ProofLabAI -- Master Architecture: Minimum Navigation                Page 5
Recruiters should see evidence and outcomes, not the internal scoring architecture.

14. Shared Product Vocabulary

Term                   Meaning                                                       Where used
Floor                  Student daily-work home.                                      Student navigation.
Lot                    Concrete unit of work.                                        Floor, Build-log, Recruiter Lots.
Build-log              Longitudinal evidence/history.                                Student navigation.
Squad                  Cooperative student team.                                     Student + TPO.
Recency                How recent/relevant an activity or proof is.                  Floor, Talent, evidence.
Calibration            Onboarding check / baseline.                                  Onboarding, not a standalone nav item.
Cosign                 Supporting validation of evidence.                            Build-log / proof.

15. Championship Under the Simple UI

Daily Lot

                                                                 

Individual evaluation

                                                                 

Individual score

                                                                 

Squad score

                                                                 

Weekly standings

                                                                 

Cohort qualification

                                                                 

Inter-cohort championship

                                                                 

Season champion + individual awards

Students see championship state primarily through Squad and relevant moments on Floor. TPOs manage it through
Squads and Insights. Recruiters see relevant evidence through Talent, Shortlist and Lots.

16. Where Features Live Now

Backend / old concept                                  New UI home
Tasks                                                  Student: Floor / Build-log; TPO: Students; Recruiter: Lots.
Submissions                                            Floor + Build-log.

ProofLabAI -- Master Architecture: Minimum Navigation                                                               Page 6
Backend / old concept                                  New UI home
Voice / 60-second explanation                          Floor + Build-log.
Scores                                                 Floor, Squad, Build-log, Insights.
Squad standings                                        Student: Squad; TPO: Squads.
Squad management                                       TPO: Squads  Manage.
Squad performance analytics                            TPO: Squads  Performance / Insights.
Member assignment                                      TPO: Squads  Assign.
Achievements / awards                                  Student: Squad / Build-log; TPO: Squads / Insights.
Matches / round robin                                  Student: Squad  Matches; TPO: Squads  Matches.
Individual leaderboard                                 Student: Squad / Build-log; TPO: Insights.
Championship status                                    Student: Squad; TPO: Squads / Insights.
CSV upload                                             TPO: Students.
ATS                                                    Profile / onboarding.
Skill gaps / risk                                      TPO: Insights / Home.

17. End-to-End UX Map

Role login

                                                                 

Student: Floor | Build-log | Squad | Profile

                                                                 

TPO: Home | Students | Squads | Insights

                                                                 

Recruiter: Home | Talent | Shortlist | Lots

                                                                 

Contextual tabs / filters handle detail

                                                                 

Complex backend modules remain behind simple UX

The sidebar remains stable. Detail lives in tabs, cards, drawers and filters.

18. Navigation Rulebook

Rule                           Decision
Primary nav count              Four sections per role.
Backend modules                Never automatically become navigation items.
Student default                Floor.
TPO default                    Home.

ProofLabAI -- Master Architecture: Minimum Navigation                                                       Page 7
Rule               Decision
Recruiter default  Home.
Championship       Contextual inside Squad/Squads; no standalone sidebar item.
Leaderboard        Contextual inside Squad/Insights; no standalone sidebar item.
Achievements       Contextual inside Squad/Build-log/Insights.
Onboarding         Tightly bounded; ends on Floor.
Calibration        Use this name for onboarding check.

19. Final Master Architecture

  PROOFLABAI

                                                                   

  Simple role-based navigation

                                                                   

  Student: Floor · Build-log · Squad · Profile

                                                                   

  TPO: Home · Students · Squads · Insights

                                                                   

  Recruiter: Home · Talent · Shortlist · Lots

                                                                   

  Contextual views handle detail

                                                                   

  Complex backend modules stay hidden behind simple UX
Final principle: The user sees a place, not a course. Few words, few sections, clear next action.

ProofLabAI -- Master Architecture: Minimum Navigation                                              Page 8
