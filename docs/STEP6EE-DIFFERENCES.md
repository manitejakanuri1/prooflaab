# Step 6EE - exact differences (generated 2026-09-28)

All diffs are of the function body text (between the `$function$` delimiters).

## 1. Production (exported) vs repository versions - comments only

Executable SQL with comments removed is identical for both functions (checked by `step6ee_build.py`, which refuses to build otherwise).

### recruiter_talent: stage69 file -> production

```diff
--- stage69 (repo)
+++ production (export)
@@ -28,5 +28,4 @@
            (select count(*) from public.tasks t
              where t.student_id = c.id and t.status in ('Completed','completed')) as lots_done,
-           -- CHANGED (stage69): verified proofs + passed auto-graded submissions.
            (select count(*) from public.proof_uploads pu
              where pu.student_id = c.id and pu.status in ('Verified','verified'))
```

### recruiter_proof_profile: stage35c file -> production

```diff
--- stage35c (repo)
+++ production (export)
@@ -8,5 +8,5 @@
   if not public.student_is_discoverable(_student_id) then
     -- Deliberately the same answer as "no such student": whether a particular
-    -- person is on this platform is itself something they did not consent to
+    -- person is on the platform is itself something they did not consent to
     -- share.
     return jsonb_build_object('error', 'No candidate found.');
@@ -36,4 +36,6 @@
                               else (current_date - p.last_active::date) end,
 
+    -- Contact details are the one thing a shortlist buys, and only if the
+    -- student said yes.
     'contact_unlocked', coalesce(accepted, false),
     'contact', case when coalesce(accepted, false) then
@@ -43,4 +45,5 @@
       else null end,
 
+    -- Skills, each with what earned the status rather than only the label.
     'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                  'skill', s.skill, 'status', s.status, 'score', s.assessed_score,
@@ -70,4 +73,5 @@
                    where s.student_id = p.id order by s.created_at desc limit 1),
 
+    -- The work itself, which is what a score is a summary of.
     'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
         select pu.id, pu.status, pu.ai_score, pu.submitted_at,
@@ -90,6 +94,6 @@
                        where v.student_id = p.id and v.communication_score is not null),
 
-    -- Consistency as weeks actually turned up, not a streak a single good
-    -- fortnight can inflate.
+    -- Consistency: how many weeks they actually turned up, not a streak number
+    -- that a single good fortnight can inflate.
     'consistency', jsonb_build_object(
       'active_weeks', (select count(*) from public.student_weekly_scores w
```

## 2. Production (exported) -> Step 6EE execution script - the only changes made

### recruiter_talent (1 filter)

```diff
--- production before
+++ after Step 6EE
@@ -33,5 +33,8 @@
              where ts.student_id = c.id and ts.status = 'passed') as proofs_verified,
            (select round(avg(v.communication_score))::integer from public.voice_explanations v
-             where v.student_id = c.id and v.communication_score is not null) as comms_score,
+             where v.student_id = c.id and v.communication_score is not null
+               -- Step 6H/6EE: only a server-transcribed explanation counts
+               -- toward the score a recruiter sees and filters on.
+               and v.transcript_source = 'server') as comms_score,
            (select count(*) from public.voice_explanations v
              where v.student_id = c.id) as explanations,
```

### recruiter_proof_profile (2 filters)

```diff
--- production before
+++ after Step 6EE
@@ -88,9 +88,12 @@
           from public.voice_explanations ve
          where ve.student_id = p.id and ve.communication_score is not null
+           -- Step 6H/6EE: same provenance gate as recruiter_talent.comms_score
+           and ve.transcript_source = 'server'
          order by ve.created_at desc limit 5) v),
 
     'communication', (select round(avg(v.communication_score))::integer
                         from public.voice_explanations v
-                       where v.student_id = p.id and v.communication_score is not null),
+                       where v.student_id = p.id and v.communication_score is not null
+                         and v.transcript_source = 'server'),
 
     -- Consistency: how many weeks they actually turned up, not a streak number
```

Function headers (signature, RETURNS, LANGUAGE, STABLE SECURITY DEFINER, SET search_path) are the exported `pg_get_functiondef` headers, unchanged.

## 3. Fingerprints (md5 of body, whitespace runs collapsed)

| | recruiter_talent | recruiter_proof_profile |
|---|---|---|
| production before (export, matches owner's pre-check) | `b47030abb6be083cb964efa247e98eb6` | `642189a0d9c35aaeeabf4a622037194a` |
| after Step 6EE | `66d86705e34347c53d759b533dbca3c9` | `95a23fd33dd0252b70492dfd31fc7818` |
| byte-exact md5(prosrc) of production before (rollback rehearsal target) | `75fd68168a024f7e50d6f33cac2af062` | `e487f9da27ba3eed8a3a2e8d0d062c71` |
