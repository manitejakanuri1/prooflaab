-- 109 rollback note: nothing is removed, on purpose.
-- 109 only adds a default theme where none existed. Production already had all nine, so 109 changed nothing there;
-- deleting the defaults would empty the Branch dropdown on College -> Import students again (only "Other…" left)
-- and change the names of squads drawn later. There is no safe automatic undo that tells the added rows from the
-- original ones, and none is needed: the rows are the same defaults stage 23 created.
-- If a default must really go, the owner names it and it is deleted by hand, after a backup.
select 1;
