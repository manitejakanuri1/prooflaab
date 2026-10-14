begin;

drop function if exists
  public.provision_college_account(
    uuid, uuid, text, text, text
  );

commit;

notify pgrst, 'reload schema';
