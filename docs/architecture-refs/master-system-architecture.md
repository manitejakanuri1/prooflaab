                 ProofLabAI
Master System Architecture &

        Product Specification

                                                Version 1.0
                                   End-to-End Product Blueprint
     College TPO Dashboard · Student Dashboard · Recruiter Dashboard

   A proof-of-skill platform that converts student claims into continuously demonstrated,
   measurable evidence.

Prepared as the master product, business, and technical reference for the ProofLabAI pilot and no-code implementation.

ProofLabAI -- Master System Architecture v1.0  Page 1
Table of Contents                                           Page 2

1. Executive Summary
2. Vision & Core Principles
3. User Roles & Access Model
4. End-to-End System Flow
5. College / TPO Dashboard
6. CSV Upload & Student Onboarding
7. Squad Formation & Naming Engine
8. Student Dashboard & Proof Journey
9. Resume / ATS Intelligence
10. Skill, Certification & Project Verification
11. Daily Job-Matched Task Engine
12. 60-Second Voice Explanation & Communication Evaluation
13. Individual Scoring, Streaks & Evidence Logs
14. Weekly Squad Scoring & Round-Robin Competition
15. Season Management & Championship
16. Recruiter Dashboard
17. Proof Profile & Candidate Discovery
18. Recruiter-Sponsored Tasks & Hiring Flow
19. Analytics & KPI Framework
20. AI Layer & Intelligence Services
21. Data Model & Core Entities
22. Notifications & Communication
23. Security, Privacy & Auditability
24. No-Code Implementation Architecture
25. MVP / Pilot Scope
26. Future Enhancements
27. Product Principles & Acceptance Criteria

ProofLabAI -- Master System Architecture v1.0
 1. Executive Summary

   ProofLabAI is an AI-enabled proof-of-skill and hiring platform designed to help colleges turn student
   development into measurable evidence and help recruiters make stronger, evidence-based hiring
   decisions.

   The platform begins with a college or TPO uploading a branch-wise student CSV. Students are invited
   to onboard, verify their identity, upload a resume, and validate the skills, certifications, and projects
   they claim. The platform then assigns students into 11-member squads, tracks individual activity,
   delivers daily job-aligned tasks, requires a 60-second explanation, and continuously builds a proof
   profile.

   The system is intentionally designed around a simple idea: a resume contains claims; ProofLabAI
   should continuously collect evidence behind those claims.

   For colleges, this creates visibility into participation, skill readiness, communication, consistency,
   squad performance, and students who may need intervention. For students, it creates a structured
   development loop. For recruiters, it creates a searchable pool of candidates with evidence, not just
   resumes.

   The platform has three primary dashboards: College/TPO, Student, and Recruiter. A platform Admin
   role supports governance, configuration, security, AI services, and auditability.

   Core outcome: by the end of a season, active students should have a richer proof profile containing
   verified skills, assessment results, task history, communication evidence, consistency signals, squad
   performance, and recruiter-sponsored task outcomes.

 2. Vision & Core Principles

   Vision: make every student more than a resume -- make them a professional with observable proof.

  Core principles
q Every claimed skill should have evidence. Resume claims are inputs to validation, not final truth.
q Consistency matters. Repeated work over time is a stronger signal than a single test.
q Communication is part of employability. A student should be able to explain what they built or solved.
q Real-world alignment. Daily work should be connected to current job requirements where practical.
q Competition should motivate, not exclude. Squad competition creates energy while the system

     should still surface improvement paths for weaker students.

q Hiring should be evidence-led. Recruiters should be able to inspect the underlying signals before

     making a decision.

q College intervention should be actionable. Analytics should identify who needs support, not just

     display charts.

  Product philosophy

   ProofLabAI should behave like a continuous loop rather than a one-time assessment: Claim  Verify 
   Practice  Explain  Measure  Compete  Improve  Prove again.

 3. User Roles & Access Model

ProofLabAI -- Master System Architecture v1.0  Page 3
Role           Primary responsibilities        Access boundary

College / TPO  College setup, branch setup, CSV import, invitations, squad Omwanacgoellmegeent/,prersmerivtteedalblorcaantciohne,sanalytics, interven

Student        Onboarding, resume, verification assessments, daily tasks, sOuwbmn ipsrsoiofinles,avnodicaesseixgpnleadnastqiounasd, feedback, proof pro

Recruiter      Candidate discovery, proof profile review, filters, shortlist, spRoencsrouriteedr twaosrkkss,phaircienganddecpiseiromnsitted candidate data

Admin          Platform configuration, governance, AI services, audit, suppoPrlat,tfsoyrsmte-mwi-dleevaedl mcoinitsrtorlastive scope

Access should follow least-privilege principles. A TPO should not see another institution's student data,
a student should not edit system-generated scores, and recruiter access should expose only the
candidate evidence required for hiring.

4. End-to-End System Flow

    The complete lifecycle is divided into the following stages:

1 College/TPO selects the branch and uploads the student CSV.
2 System validates rows, detects duplicates and errors, and creates eligible student records.
3 System sends onboarding invitations through email and/or WhatsApp.
4 Student opens the invite, verifies identity/contact details, and completes onboarding.
5 System assigns students into 11-member squads; remaining students become the reserve pool.
6 Student receives the assigned squad and enters the Student Dashboard.
7 Student uploads a resume; AI calculates an ATS/readiness score.
8 If the score is below the configured threshold, the AI resume rebuild flow is offered and a revised

       score is calculated.

9 System extracts claimed skills, certifications, and projects from the resume.
10 Student completes a validation assessment: 5 MCQs, 2 descriptive questions, and 2 coding

       questions.

11 System evaluates strengths and gaps and either permits progression or generates an improvement

       path.

12 Daily task engine finds relevant job descriptions and maps task opportunities to verified/claimed

       skills.

13 Student completes a daily task and records a 60-second explanation.
14 AI transcribes and evaluates the explanation for clarity, articulation, completeness, and

       understanding; feedback is returned.

15 System logs task completion, scores, streaks, communication evidence, and other activity signals.
16 Each Sunday at the configured weekly cutoff, individual and squad scores are aggregated.
17 Squads enter a round-robin competition schedule for the following week.
18 At the end of a configurable season, the system declares champion, runner-up, and third place and

       generates improvement reports.

19 Recruiters discover candidates through proof profiles, compare evidence, shortlist candidates, and

       may sponsor domain-specific tasks.

20 Student completes a sponsored task and submits it to the recruiter.

ProofLabAI -- Master System Architecture v1.0                   Page 4
21 Recruiter reviews the result and may proceed toward an internship or job offer.
   High-level flow

    College CSV  Invite  Verify  Squad  Resume  ATS  Skill Validation  Daily Task  60-sec
    Explain  AI Feedback  Weekly Score  Squad Competition  Season  Proof Profile  Recruiter
    Shortlist  Sponsored Task  Hiring

  5. College / TPO Dashboard

   The TPO dashboard is the operational control center for the college pilot.

  Core dashboard sections
q Overview / Pilot health
q Branches and cohorts
q Student import
q Student onboarding status
q Squads
q Reserve pool
q Weekly leaderboard
q Season / competition
q Student activity analytics
q At-risk / inactive students
q Reports and exports

   TPO home metrics should include total students imported, verified/onboarded, active today, active this
   week, resume completion, assessment completion, average individual score, squad standings, inactive
   count, and students requiring attention.

 6. CSV Upload & Student Onboarding

CSV is the first operational entry point. The upload experience must be predictable and safe because
downstream squad and analytics logic depends on clean student records.

Required CSV columns

Field                Required                  Purpose
Student Roll Number  Yes                       College-specific identity / roll reference
Student Name         Yes                       Display and profile identity
Email                Yes                       Primary onboarding channel
Phone Number         Yes                       WhatsApp/SMS communication and contact
Branch               Yes                       Cohort and squad grouping
Year                 Yes                       Third-year / fourth-year cohort control

Upload validation

ProofLabAI -- Master System Architecture v1.0                                              Page 5
q File type and header validation.
q Required column validation.
q Duplicate roll number detection within the upload.
q Duplicate email/phone checks against existing college records.
q Branch and year normalization.
q Invalid row reporting without losing valid rows.
q Downloadable error report with row number and reason.
q Import summary: total rows, valid rows, invalid rows, duplicates, created records, updated records.

  Onboarding notification

   After a successful import, the platform sends invitations to eligible students using configured channels.
   The invite should contain a secure onboarding link, college/branch context, basic instructions, and a
   support route.

 7. Squad Formation & Naming Engine

   Squads are the core competitive unit. Each squad contains exactly 11 active members when fully
   formed.

  Formation rule

   For N eligible/onboarded students, the system creates floor(N / 11) full squads and places the
   remainder into the reserve pool. Example: 70 students  6 squads × 11 = 66 students, with 4
   reserves. Example: 76 students  6 squads × 11 = 66 students, with 10 reserves.

   Important operating rule: reserves remain eligible and visible to the TPO. The TPO can allocate a
   reserve student into a selected squad through an explicit re-allocation action. Every such change
   should create an audit event.

  Naming model

   Names follow an IPL-style pattern using college/location identity plus a branch-specific theme.
   Example: Pragati Engineering College in Surampalem, CSE branch  "Surampalem Warriors Titans." IT
   could use a distinct branch theme such as "Surampalem Warriors Intellects."

   Naming should be generated from configurable templates so colleges can later choose their own
   theme, language, or naming dictionary.

   Squad record should include squad ID, season ID, college ID, branch ID, squad name, member count,
   reserve status, created timestamp, and status.

 8. Student Dashboard & Proof Journey

   The Student Dashboard should make the next action obvious. The primary experience is a guided
   journey rather than a collection of disconnected screens.

  Recommended primary navigation
q My Dashboard
q My Proof Profile
q My Skills

ProofLabAI -- Master System Architecture v1.0  Page 6
q My Resume
q Assessment
q Daily Tasks
q My Submissions
q Voice Explanations
q Squad
q Leaderboard
q Streaks & Progress
q Feedback / Improvement

   Dashboard home should prioritize today's task, today's status, current streak, personal score, squad
   position, pending actions, and recent feedback.

9. Resume / ATS Intelligence

    Resume upload is the first evidence-building step after onboarding.

    The AI layer should extract structured data from the resume: skills, tools, certifications, projects,
    experience, education, keywords, and role signals.

    An ATS/readiness score is used as a product gate and improvement signal. The pilot specification
    currently uses 60% as the working threshold: at or above 60%, the student may progress; below 60%,
    the system offers an AI-assisted resume rebuild.

   Resume rebuild loop
1 Analyze resume structure, keywords, relevance, clarity, and role alignment.
2 Identify gaps and weak phrasing.
3 Offer AI-assisted rewrite/rebuild.
4 Present the revised resume for student review.
5 Re-score the revised version.
6 Store both the original and revised versions with timestamps and version metadata.

    The system should never fabricate qualifications, certifications, project outcomes, or experience while
    rebuilding a resume. AI should improve representation of existing evidence, not invent evidence.

10. Skill, Certification & Project Verification

A resume claim is not treated as verified simply because it appears in the document. ProofLabAI
creates a validation layer around claimed skills and credentials.

Assessment structure

Component                                      Count  Purpose
Multiple-choice questions                      5      Quick knowledge/skill validation
Descriptive questions                          2      Reasoning and conceptual explanation
Coding questions                               2      Applied problem solving / implementation

ProofLabAI -- Master System Architecture v1.0                                                    Page 7
    The assessment engine should select questions based on the student's claimed skills, projects,
    certifications, and relevant level. Results should produce a skill-level evidence state such as Claimed,
    Assessed, Supported, Needs Improvement, or Insufficient Evidence.

    For certifications, the product can later add issuer verification or certificate upload checks. For
    projects, it can capture repository/demo evidence where available.

  11. Daily Job-Matched Task Engine

    After validation, the system enters the daily practice loop. The task engine uses current or recently
    collected job-description signals to create small, realistic tasks aligned to the student's skills.

   Task generation pipeline
1 Collect permitted job-description signals from configured sources.
2 Extract role, skills, tools, seniority, and recurring task patterns.
3 Match signals to the student's verified/claimed skill profile.
4 Generate a bounded task appropriate to the student's level.
5 Attach evaluation criteria and expected evidence.
6 Deliver one primary task card for the day.
7 Capture submission, explanation, AI evaluation, and feedback.

    Task types may include a small implementation task, debugging task, code review, data/query task,
    reasoning prompt, documentation task, or bug-finding exercise. The platform should keep tasks small
    enough to complete consistently.

  12. 60-Second Voice Explanation &
  Communication Evaluation

    The student must explain the completed task in approximately 60 seconds. This requirement exists
    because task completion alone does not prove understanding or communication ability.

   Processing pipeline
1 Student records a voice explanation.
2 Audio is stored with task and submission metadata.
3 Speech-to-text converts the recording into a transcript.
4 AI evaluates clarity, articulation, completeness, structure, and evidence of understanding.
5 The system generates a score and concise feedback.
6 The evidence becomes part of the student's proof profile.

    Evaluation should distinguish technical correctness from communication quality. A student can
    complete a task successfully but still receive communication feedback, and vice versa.

  13. Individual Scoring, Streaks & Evidence
  Logs

ProofLabAI -- Master System Architecture v1.0  Page 8
    Every meaningful student action should create an evidence event. The platform should maintain an
    immutable event history and calculate derived scores from those events.

   Example evidence events
 q Onboarding completed
 q Resume uploaded
 q ATS score generated
 q Resume rebuilt
 q Assessment completed
 q Skill evidence updated
 q Daily task assigned
 q Task submitted
 q Voice explanation submitted
 q Communication score generated
 q Feedback viewed
 q Streak continued/broken
 q Squad participation recorded
 q Sponsored task completed

   Score model

    The exact weights should remain configurable. A suggested architecture is to separate Skill Proof, Task
    Performance, Communication, Consistency, and Squad Contribution into distinct dimensions, then
    calculate an overall score without hiding the underlying components.

  14. Weekly Squad Scoring & Round-Robin
  Competition

    Each squad's weekly score is derived from the individual performance of its 11 members and the
    configured squad rules.

   Weekly process
1 Collect all eligible individual events through the weekly cutoff.
2 Calculate individual scores.
3 Aggregate individual scores into squad score.
4 Rank squads.
5 Publish the weekly leaderboard.
6 Generate the next week's round-robin fixtures.
7 Surface individual and squad improvement opportunities.

    The competition should be designed so that weaker students are not permanently hidden. The TPO and
    system should be able to identify inactive members, provide improvement actions, and allow reserves
    to be reallocated where appropriate.

ProofLabAI -- Master System Architecture v1.0  Page 9
 15. Season Management & Championship

   A season is a configurable period, such as 8, 10, or 15 weeks, depending on cohort size and college
   calendar.
   At season end, the system publishes Champion, Runner-up, and Third Place, along with complete
   squad standings and individual development reports.
   Season output should include a season summary, squad performance history, individual score
   trajectories, participation, streaks, communication trends, task completion, and improvement
   recommendations.

 16. Recruiter Dashboard

   The Recruiter Dashboard is the evidence-led hiring workspace. It should allow recruiters to discover
   candidates based on role fit and then inspect the underlying proof.

  Core sections
q Recruiter Home
q Candidate Discovery
q Filters & Search
q Proof Profile
q Shortlist
q Sponsored Tasks
q Task Submissions
q Hiring Pipeline
q Offers / Outcomes
q Analytics

   Candidate filters can include branch, skills, skill score, assessment performance, activity recency,
   consistency, communication score, squad performance, season rank, and sponsored-task performance.

 17. Proof Profile & Candidate Discovery

   The Proof Profile is the central product artifact that connects student activity to recruiter decisions.

  Recommended profile sections
q Candidate identity and education
q Resume
q Verified / assessed skills
q Certifications and evidence
q Projects and evidence
q Assessment scores
q Daily task performance
q Communication / 60-second explanation evidence

ProofLabAI -- Master System Architecture v1.0  Page 10
q Consistency and activity recency
q Streaks
q Squad and season performance
q Recruiter-sponsored task history
q Recommended role fit

   The recruiter should be able to move from summary to evidence: a score is useful, but the underlying
   evidence must remain inspectable.

 18. Recruiter-Sponsored Tasks & Hiring Flow

    Recruiters can sponsor a domain-specific task for a shortlisted candidate. This is a critical bridge
    between platform-generated proof and employer-specific evaluation.

1 Recruiter discovers a candidate.
2 Recruiter reviews proof profile and evidence.
3 Recruiter shortlists the candidate.
4 Recruiter creates a sponsored task with instructions and evaluation criteria.
5 Candidate receives the task in the Student Dashboard.
6 Candidate completes and submits the task.
7 Recruiter reviews the submission and available evidence.
8 Recruiter records an outcome: continue, reject, request another step, internship opportunity, or job

       opportunity.

9 The outcome is logged for the candidate's hiring journey.

    The platform should distinguish platform-generated scores from recruiter-specific evaluation. Neither
    should overwrite the other.

  19. Analytics & KPI Framework

College analytics

Metric group       Examples
Cohort             Students imported, onboarded, branch/year distribution
Engagement         Daily active students, weekly active students, task completion rate
Readiness          Resume completion, ATS distribution, assessment completion
Skills             Top skills, weak skill clusters, skill improvement trends
Communication      Voice completion, communication score trends
Competition        Squad rankings, weekly movement, participation
Risk               Inactive students, broken streaks, repeated weak scores
Outcomes           Shortlists, sponsored tasks, internships/jobs

Recruiter analytics

ProofLabAI -- Master System Architecture v1.0                                           Page 11
q Candidate pool by skill and role.
q Shortlist conversion.
q Sponsored task completion.
q Sponsored task pass/advance rate.
q Hiring outcomes.
q Candidate quality by proof dimensions.

  Student analytics
q Current score and score trend.
q Skill strengths and gaps.
q Task completion and streak.
q Communication trend.
q Squad position.
q Season trajectory.

 20. AI Layer & Intelligence Services

   AI is used as an evaluation and personalization layer, but important platform decisions should remain
   explainable and configurable.

  AI services
q Resume parsing and structured extraction
q ATS/readiness analysis
q Resume improvement assistant
q Skill/project/certification extraction
q Assessment question generation and adaptation
q Answer evaluation
q Job-description skill extraction
q Daily task generation
q Speech-to-text
q Communication evaluation
q Feedback generation
q Candidate-role matching
q Analytics summarization

  Guardrails
q Never invent qualifications.
q Keep AI-generated scores explainable at component level.
q Store model/version metadata for important evaluations.

ProofLabAI -- Master System Architecture v1.0  Page 12
q Allow human override where operationally necessary.
q Separate generated recommendations from verified evidence.

 21. Data Model & Core Entities

Entity              Purpose

College             Institution identity and configuration

Branch              Branch/cohort grouping

Season              Competition period and rules

Student             Core student record

StudentProfile      Profile, education, contact, preferences

Resume              Resume versions and ATS results

Skill               Canonical skill catalog

StudentSkill        Claimed/assessed/verified skill state

Certification       Certification claim/evidence

Project             Project claim/evidence

Assessment          Assessment instance

AssessmentQuestion  Question and metadata

AssessmentAnswer    Student answer and evaluation

Squad               11-member competitive unit

SquadMembership     Student-to-squad assignment history

Task                Daily or sponsored task

TaskSubmission      Student work and evaluation

VoiceEvidence       Audio/transcript/communication evaluation

ScoreEvent          Atomic score/evidence event

WeeklyScore         Weekly individual and squad aggregates

Fixture             Round-robin matchup

ProofProfile        Recruiter-facing evidence summary

Recruiter           Recruiter identity/workspace

SponsoredTask       Recruiter-created evaluation task

Notification        Email/WhatsApp/in-app event

AuditLog            Security and operational history

The data model should preserve history rather than overwriting important evidence. Squad
membership, resume versions, scores, and evaluations should be versioned or event-backed.

22. Notifications & Communication

Primary channels are email, WhatsApp where available and consented, and in-app notifications.

ProofLabAI -- Master System Architecture v1.0                                                  Page 13
  Notification events
q Invitation / onboarding
q Verification reminder
q Resume upload reminder
q Assessment assigned
q Assessment result
q Daily task available
q Task due reminder
q Voice explanation reminder
q Weekly result
q Squad fixture
q Season milestone
q Recruiter shortlist
q Sponsored task assigned
q Recruiter outcome

   Notification preferences and consent should be explicit. The system should prevent repeated or
   excessive messages.

 23. Security, Privacy & Auditability

   Because the platform processes student identity, educational records, resumes, voice recordings, and
   hiring activity, security and privacy are product requirements, not optional add-ons.

q Role-based access control.
q Tenant isolation by college/recruiter workspace.
q Secure file storage and access-controlled downloads.
q Encryption in transit and at rest where supported.
q Audit logs for administrative changes, score overrides, squad reallocations, and recruiter actions.
q Consent and retention controls for voice/audio and communication evidence.
q Minimal exposure of personal information to recruiters.
q Configurable data retention and deletion workflows.
q Backups and recovery procedures.
q Human review path for disputed evaluation outcomes.

 24. No-Code Implementation Architecture

   The initial pilot can be built using a no-code/low-code stack, provided the data model and workflows
   are defined first.

  Suggested logical layers

ProofLabAI -- Master System Architecture v1.0  Page 14
Layer                  Responsibility

UI / Dashboards        TPO, Student, Recruiter interfaces

Workflow / Automation  Onboarding, notifications, scoring, weekly jobs

Database               Students, squads, tasks, scores, evidence, recruiter actions

AI Services            Resume, assessment, task, voice, matching

File Storage           Resumes, audio, evidence artifacts

Messaging              Email, WhatsApp, in-app notifications

Analytics              Dashboard metrics, leaderboards, reports

Auth / RBAC            Login, role, tenant permissions

Implementation principle: build the system as small, testable modules rather than one giant workflow.
Each module should have clear inputs, outputs, validation rules, and failure states.

25. MVP / Pilot Scope

    Pilot objective: validate the end-to-end proof-of-skill loop with a limited college cohort, initially focusing
    on third- and fourth-year students in a selected branch.

   Recommended MVP
1 College/TPO authentication and basic college/branch setup.
2 CSV upload with validation and import report.
3 Email onboarding invitation; add WhatsApp as a configurable channel.
4 Student onboarding and profile.
5 11-member squad formation and reserve pool.
6 TPO squad/reallocation controls.
7 Resume upload and ATS score.
8 AI resume rebuild flow.
9 Skill/project/certification extraction.
10 Validation assessment: 5 MCQ + 2 descriptive + 2 coding.
11 Daily task card.
12 Task submission.
13 60-second voice recording and transcript.
14 Communication feedback.
15 Individual score, streak and evidence log.
16 Weekly squad leaderboard.
17 Basic round-robin fixture generation.
18 Recruiter proof profile and candidate shortlist.
19 One sponsored-task workflow.

ProofLabAI -- Master System Architecture v1.0                                        Page 15
  Defer until after pilot
q Advanced external job-board integrations.
q Large-scale automated sourcing.
q Complex recruiter workflow automation.
q Deep certification issuer integrations.
q Highly customized college themes.
q Advanced predictive analytics.
q Multi-language voice evaluation at scale.

 26. Future Enhancements

q AI-generated personalized learning plans.
q Role-specific season templates.
q Company-specific skill benchmarks.
q GitHub / portfolio evidence integration.
q Verified certification integrations.
q Peer collaboration and squad mentorship.
q Recruiter interview scheduling and structured feedback.
q College intervention workflows and mentor assignment.
q Advanced fraud / plagiarism / AI-use disclosure signals.
q Cross-college competitions.
q Alumni proof profiles.
q Institution-level employability benchmarking.

 27. Product Principles & Acceptance Criteria

   The following principles should be used as a product acceptance checklist before each major release.

q Clarity: a student should always know the next action.
q Evidence: important claims should be linked to supporting activity or evaluation.
q Consistency: scores should be reproducible from stored inputs and rules.
q Explainability: students and admins should understand why a score changed.
q Safety: AI must not fabricate qualifications or evidence.
q Auditability: important administrative and hiring actions must be traceable.
q Competition with inclusion: the league should motivate improvement and expose support needs.
q Recruiter usefulness: a recruiter should be able to move from candidate discovery to evidence to

     sponsored task without losing context.

q Modularity: each no-code workflow should be independently testable.

ProofLabAI -- Master System Architecture v1.0  Page 16
q Configurable rules: thresholds, scoring weights, season length, squad naming, and notification

     settings should not be hard-coded where avoidable.

  Master flow acceptance test

   A successful pilot should demonstrate the complete chain: CSV import  onboarding  squad
   assignment  resume/ATS  skill validation  daily task  task submission  60-second explanation 
   AI feedback  individual score  weekly squad score  round-robin competition  season outcome 
   proof profile  recruiter shortlist  sponsored task  hiring outcome.

   Document status: Master Architecture v1.0 -- initial product specification based on the agreed ProofLabAI concept and
   pilot flow.

ProofLabAI -- Master System Architecture v1.0  Page 17
