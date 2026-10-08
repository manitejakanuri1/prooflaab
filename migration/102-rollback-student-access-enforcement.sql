-- Unsafe rollback: reviewed forward migration required.
do $$ begin raise exception 'unsafe rollback refused'; end $$;
