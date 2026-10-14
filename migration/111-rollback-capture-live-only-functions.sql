-- 111 rollback note: nothing is removed, on purpose.
-- 111 only writes down two functions the live databases already had (same body, same grants). Dropping them would
-- break onboarding and the student activity mark on every database, including the ones that had them before 111.
select 1;
