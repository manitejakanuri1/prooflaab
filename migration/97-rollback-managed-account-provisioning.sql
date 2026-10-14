begin;

drop function if exists public.provision_company_account(
  uuid, uuid, text, text, text
);

drop function if exists public.provision_admin_account(
  uuid, uuid
);

commit;

notify pgrst, 'reload schema';
