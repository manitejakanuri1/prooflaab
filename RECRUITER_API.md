# Recruiter API — what the screens call

Everything below is **live in the database now** and tested with real signed-in
sessions. Build the screens against these shapes and the merge is a file swap,
not a rewrite.

If you are building screens with mock data, make `src/recruiter/mockData.ts`
return exactly these shapes.

---

## Signing up as a recruiter

```ts
// after auth.signUp, with role 'recruiter' in user_roles
await supabase.from('recruiters').insert({
  id: user.id,          // must equal the auth user id
  company: 'NovaTech Hiring',
  contact_name: 'Nikhil Rao',
  work_email: 'nikhil@novatech.example',
  website: 'https://novatech.example',
});
// verified is false. An admin turns it on. Until then: no candidates.
```

---

## HOME

```ts
const { data } = await supabase.rpc('recruiter_home');
```

Unverified:

```json
{ "verified": false, "company": "NovaTech Hiring",
  "message": "Your account is awaiting verification. Candidates appear once an administrator has approved you." }
```

Verified:

```json
{
  "verified": true,
  "company": "NovaTech Hiring",
  "candidates_available": 12,
  "new_this_week": 3,
  "shortlisted": 4,
  "awaiting_response": 2,
  "accepted": 1,
  "lots_open": 2,
  "lots_submitted": 1,
  "pipeline": { "saved": 2, "contacted": 1, "sponsored": 1 },
  "recommended": [
    { "student_id": "uuid", "full_name": "Priya Verma", "branch": "CSE",
      "target_role": "Backend Developer", "skills_proven": 4,
      "proofs_verified": 6, "comms_score": 78, "days_since_active": 1 }
  ],
  "recent_views": [
    { "student_id": "uuid", "full_name": "Priya Verma", "viewed_at": "2026-08-24T…" }
  ]
}
```

Every number on Home should be clickable and lead somewhere.

---

## TALENT

```ts
const { data } = await supabase.rpc('recruiter_talent', {
  _role: 'Backend',        // or null
  _skills: ['React','SQL'],// or null
  _branch: 'CSE',          // or null
  _min_skill: 60,          // or null
  _min_comms: 70,          // or null
  _active_within: 7,       // days, or null
  _limit: 50,
  _offset: 0,
});
```

Returns an array. `total_matches` is the same on every row — use it for paging.

```json
[{
  "student_id": "uuid",
  "full_name": "Priya Verma",
  "branch": "CSE", "batch": "2027",
  "target_role": "Backend Developer",
  "total_xp": 315, "trust_score": 72.5,
  "skills_proven": 4, "skills_total": 7,
  "top_skills": ["React","SQL","TypeScript"],
  "lots_done": 18, "proofs_verified": 6,
  "comms_score": 78, "explanations": 9,
  "days_since_active": 1, "active_weeks": 6,
  "squad_name": "Surampalem Warriors Titans",
  "squad_rank": 1, "season_points": 177,
  "shortlisted": false,
  "total_matches": 12
}]
```

Filter options, drawn only from candidates this recruiter may see:

```ts
const { data } = await supabase.rpc('recruiter_filters');
// { verified: true, branches: [...], roles: [...], skills: [...], total: 12 }
// { verified: false }   when awaiting verification
```

---

## PROOF PROFILE

```ts
const { data } = await supabase.rpc('recruiter_proof_profile', { _student_id: id });
await supabase.rpc('recruiter_log_view', { _student_id: id });   // fire and forget
```

```json
{
  "id": "uuid",
  "full_name": "Priya Verma",
  "branch": "CSE", "batch": "2027", "year_of_study": "3",
  "target_role": "Backend Developer",
  "secondary_roles": ["Data Engineer"],
  "work_preference": "internship",
  "preferred_locations": ["Hyderabad"],
  "open_to_relocate": true,
  "total_xp": 315, "trust_score": 72.5,
  "last_active": "2026-08-24T…", "days_since_active": 0,

  "contact_unlocked": false,
  "contact": null,

  "skills": [
    { "skill": "React", "status": "proven", "score": 82,
      "lots": 5, "explanations": 3, "last_evidence_at": "2026-08-20T…" }
  ],
  "certifications": [
    { "name": "AWS Cloud Practitioner", "issuer": "AWS",
      "issued_on": "2026-03-01", "url": "https://…", "source": "resume" }
  ],
  "scorecard": {
    "resume_quality": 71, "ats_match": 66, "skill_proof": 74,
    "project_proof": 68, "reasoning": 70, "coding": 65,
    "interview_readiness": 69, "skill_gap": {...}, "at": "2026-08-21T…"
  },
  "work": [
    { "id": "uuid", "title": "Fix the duplicate-ticket query",
      "status": "Verified", "ai_score": 78,
      "submitted_at": "2026-08-20T…", "difficulty": "Medium" }
  ],
  "explanations": [
    { "id": "uuid", "about": "Fix the duplicate-ticket query",
      "duration_seconds": 58, "communication_score": 78,
      "communication_notes": "Clear structure…", "created_at": "2026-08-20T…" }
  ],
  "communication": 78,
  "consistency": { "active_weeks": 6, "weeks_total": 7,
                   "current_streak": 4, "lots_done": 18 },
  "squad": { "name": "Surampalem Warriors Titans", "rank": 1,
             "points": 177, "record": "3-2-0", "contribution": 46 },
  "ladder": { "track": "web-development", "cleared": 12 },
  "shortlist": { "stage": "saved", "response": null, "note": "Strong SQL" }
}
```

Two things to build around:

- **`contact` is `null` until `contact_unlocked` is true.** It becomes an object
  with email, phone, github and linkedin only after the student accepts. Show a
  locked state, not an empty field.
- **Every score has its evidence in the same payload.** `skills` carries the
  lots and explanations that earned each status; `work` is the actual
  submissions; `explanations` are the recordings. Make each number open the
  thing underneath it. This is the rule that makes the page worth having.

Refused states — both are `{ "error": "…" }`:

```
   awaiting verification  ->  "Your recruiter account is awaiting verification."
   not discoverable       ->  "No candidate found."
```

The second is deliberately identical to a genuine miss. Whether a particular
person is on this platform is itself private.

---

## SHORTLIST

```ts
await supabase.rpc('recruiter_shortlist', {
  _student_id: id,
  _note: 'Strong SQL, explains well',   // optional
});
// -> { ok: true, company: 'NovaTech Hiring' }
// the student is notified and decides about their contact details
```

Read the recruiter's own list straight from the table:

```ts
const { data } = await supabase
  .from('recruiter_shortlists')
  .select('id, student_id, note, stage, student_response, responded_at, created_at')
  .order('created_at', { ascending: false });
```

`stage` is one of:
`saved · contacted · sponsored · interviewing · offered · hired · passed`

`student_response` is `null` (not answered), `'accepted'` or `'declined'`.

Move a candidate along:

```ts
await supabase.rpc('record_outcome', { _student_id: id, _outcome: 'interviewing' });
```

---

## LOTS

Sponsor work for a shortlisted candidate:

```ts
await supabase.rpc('sponsor_lot', {
  _student_id: id,
  _title: 'Fix a slow report query',
  _brief: 'Our nightly report takes 40 minutes…',
  _criteria: 'We look for the real cause named, not just a faster query.',
  _days: 5,
});
// -> { ok: true, task_id: 'uuid', company: 'NovaTech Hiring' }
```

It appears on that student's Daily Card. Shortlisting first is required —
sponsoring without it throws.

See what came back:

```ts
const { data } = await supabase.rpc('recruiter_lots');
```

```json
[{
  "task_id": "uuid", "title": "Fix a slow report query",
  "student_id": "uuid", "student_name": "Priya Verma",
  "created_at": "…", "due_date": "…", "task_status": "pending",
  "proof_id": "uuid", "submitted_at": "…", "proof_status": "Under Review",
  "ai_score": 78, "outcome": "sponsored"
}]
```

`proof_id` is `null` until the student submits.

---

## STUDENT SIDE — build this too

The student needs to see who shortlisted them and answer. Two calls:

```ts
const { data } = await supabase.rpc('my_shortlists');
// [{ id, company, note, stage, student_response, created_at }]

await supabase.rpc('respond_to_shortlist', {
  _shortlist_id: id,
  _accept: true,     // or false
});
```

Accepting is what unlocks contact details for that one recruiter. Nobody else.

---

## ADMIN SIDE

```ts
const { data } = await supabase.rpc('admin_recruiters');
// [{ id, company, contact_name, work_email, website, verified,
//    created_at, shortlists, sponsored }]

await supabase.rpc('admin_verify_recruiter', {
  _recruiter_id: id,
  _verified: true,
});
```

---

## What is enforced in the database, not the screen

You cannot break these from the front end, and you do not need to re-check them:

```
   an unverified recruiter sees zero candidates everywhere
   a student who has not made their portfolio public is unreachable,
     including by guessing their id
   email, phone and roll number are absent from every payload until
     the student accepts
   recruiter A cannot read recruiter B's shortlist, Lots or views
   a college cannot read any recruiter table
   a recruiter cannot open a college dashboard
   a recruiter cannot verify themselves
```

All nine were tested with real sessions before this document was written.

---

## Test accounts

Password for all of them: `ProofLab#Test2026`

```
   vidyuthsetu+recruiter1@gmail.com    NovaTech Hiring    verified
   vidyuthsetu+recruiter2@gmail.com    Bluewave Systems   NOT verified
   vidyuthsetu+admin@gmail.com         admin
   vidyuthsetu+student1@gmail.com      a college student
```

Only one student is currently discoverable, because only one has turned their
portfolio on. That is the consent rule working, not a bug. To make more
candidates appear for testing, sign in as a student and switch the portfolio on
in Profile → Privacy.
