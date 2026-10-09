-- 106 rollback NOTE: there is no safe rollback. Undoing 106 puts back the 'proofs' entry that reads the dropped
-- table public.proof_uploads, which makes every student removal fail again. Fix forward instead.
do $$ begin raise exception '106 rollback refused: it would break every student removal again'; end $$;
