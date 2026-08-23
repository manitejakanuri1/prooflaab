# Resume-to-Readiness Feature — Status

Reference doc for what's built vs. what's left on the resume-first flow.
Supabase project: `ajaeneehxlnmnhjtvrgs` (switched from the old `zlfjxcwltqtajnczfjjp`).
Live at: `prooflaab.vercel.app` (auto-deploys from `main`).

## Built

**1. Resume-first onboarding**
- Right after signup wizard, student lands on a dedicated full-screen page (`/student/resume-onboarding`), not the dashboard.
- Uploads resume (PDF) → Gemini extracts skills/certs/projects/target role.

**2. Tiered feedback gate**
- ATS score < 65: "bad" — offers manual edit or AI auto-fix.
- 65–85: "good" — same offer.
- \> 85: "excellent" — skips the fix offer, instead judges whether the claimed skills are actually valuable and what to focus on next.
- AI auto-fix produces a real downloadable PDF (jsPDF), not just text.

**3. Confirm claims**
- Student reviews/edits extracted skills, certs, projects, target role before it's used to test them.

**4. Timed quiz**
- 10 questions (8 MCQ incl. code-reading snippets, 2 project-defense short answers).
- 15 seconds each, hard timer, forward-only, no retaking a question, auto-submits at the end.

**5. Voice defense**
- After the quiz, one voice recording where the student explains why they answered the way they did.
- Converted to WAV client-side (Gemini doesn't accept the webm MediaRecorder produces), analyzed by Gemini alongside their actual answers to catch guessing.
- Scored as "Voice authenticity."

**6. Real coding round**
- 2 actual coding problems in the student's claimed language, Monaco editor, 5 minutes each (no time pressure like the MCQs).
- "Run sample" checks one visible test case; "Submit" runs 3 hidden test cases via **Wandbox** (free code-exec API — Piston went whitelist-only Feb 2026, had to swap).
- Scored on pass rate.

**7. JD (job description) matching**
- Student pastes a real job posting; Gemini compares it against their confirmed claims specifically (not the generic inferred target role).
- Returns match score, matched skills, missing skills, and suggestions. Server-side only writes (student can't forge their own score).

**8. Retest history**
- Every retake already inserted a new `resume_scorecards` row. Added a table showing all past attempts with date + all 5 scores, so progress over time is visible.

**9. Certification radar**
- Scans target role + current skills + existing certs, suggests 4-6 real certifications (actual providers only, never invented) worth pursuing next, ranked by priority, skips anything they already have.

**10. Auth fixes (unrelated but blocking)**
- Fixed onboarding wizard stuck-loop bug: students had no RLS permission to mark their own wizard complete, so every new signup silently bounced back to onboarding forever. Fixed via a narrow `complete_own_wizard()` RPC.
- Fixed Vercel deploy silently failing on every push (git commit email wasn't a verified GitHub email → Vercel's deploy protection blocked it).
- Fixed SPA 404 on any route but `/` on Vercel (missing rewrite rule).

## Still open (from the original doc, not built)

- Opportunity tracker
- Interview simulator
- Recruiter-facing public proof profile showing these scores
- Deeper college-side analytics on top of this data

## Known pending items (yours, not code)

- Google OAuth still needs enabling on the new Supabase project (client ID/secret from Google Cloud Console).
- Revoke the Supabase access token that was pasted into chat during setup, once you're confident everything's stable.

## Key files (for picking this back up later)

- Flow logic: `src/components/dashboard/student/ResumeCheckFlow.tsx` (shared by the dashboard tab and the onboarding page)
- Onboarding entry: `src/pages/StudentResumeOnboarding.tsx`
- Quiz + voice + coding UI: `src/components/dashboard/student/TimedResumeAssessment.tsx`
- Edge functions: `supabase/functions/resume-*` (parser, improve, question-generator, assessment-submit, voice-verify, coding-generate, code-execute, jd-match, cert-radar)
- Migrations: `supabase/migrations/20260726*` through `20260728*`
