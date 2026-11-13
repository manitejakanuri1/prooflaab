-- Rollback 225: the badge goes back to its old name. Slug and rule never changed.
update public.badges set name = 'Proven Once',
       description = 'Your first verified proof. Someone checked, and it held up.'
 where slug = 'first-proof';
