# Proposed cleanup of the labelled `g1b-test-*` staging rows

**Status: PROPOSAL ONLY. Nothing has been deleted.** Run only after the owner approves, on **staging**
(`prooflab-staging-db`), never production.

## What they are

Two rows added on 2026-09-29 so the Build-Log "Scoring" and legacy "Self-reported / Not scored"
badges could be seen live. Both belong to the staging test student t07 (`7d71bff4-…`).

| id | idempotency key prefix | what it was | state now |
|---|---|---|---|
| `b19d8dc4-3784-4a63-920a-59623d2bd4d1` | `g1b-test-legacy-` | legacy self-reported, not scored | unchanged |
| `14e0f8b2-4884-4b3e-a25a-00f097c9b9c1` | `g1b-test-scoring-` | server transcript awaiting score | since scored by transcription-reap |

## Important: do not delete the audio file

Both rows point at `7d71bff4-…/1790365705557-explain.webm`, which **many other staging test rows
also use**. Delete the database rows only, never the storage object.

## Steps (after approval)

1. **Look first.** This is read-only and must return exactly the 2 rows above:
   ```sql
   select id, transcription_idempotency_key, transcript_source, status, communication_score
     from public.voice_explanations
    where id in ('b19d8dc4-3784-4a63-920a-59623d2bd4d1', '14e0f8b2-4884-4b3e-a25a-00f097c9b9c1')
      and transcription_idempotency_key like 'g1b-test-%'
      and student_id = '7d71bff4-1ec2-4778-b26d-9567a416bfac';
   ```
2. **Back up.** Save that result (export as CSV) with the date.
3. **Delete, fail-closed.** Nothing is deleted unless exactly 2 rows match:
   ```sql
   begin;
   do $$
   declare n integer;
   begin
     delete from public.voice_explanations
      where id in ('b19d8dc4-3784-4a63-920a-59623d2bd4d1', '14e0f8b2-4884-4b3e-a25a-00f097c9b9c1')
        and transcription_idempotency_key like 'g1b-test-%'
        and student_id = '7d71bff4-1ec2-4778-b26d-9567a416bfac';
     get diagnostics n = row_count;
     if n <> 2 then raise exception 'expected to delete 2 rows, would delete %', n; end if;
   end $$;
   commit;
   ```
4. **Verify.** Re-run step 1; it must return 0 rows.

## Other labelled staging test data (not part of this proposal)

Earlier Step 6 checks also left labelled rows (`g1-test-*`, `g1r-test-*`, `g1s-test-*`,
`g1w-test-*`, `g1u-test-*`, `g1v-test-*`) and unlabelled browser-test recordings of t07. A
separate, owner-approved sweep can use the same pattern.
