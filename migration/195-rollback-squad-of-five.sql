-- Rollback of 195: elevens only again (184's text) and no my_reserve_status.
begin;
do $do$
declare body text; nb text;
begin
  body := pg_get_functiondef('public.form_squads_in(uuid)'::regprocedure);
  nb := replace(body,
    E'    -- 195: squads of eleven; five or more left over make one more squad; fewer than five wait in Reserve\n    k := n / 11 + case when n % 11 >= 5 then 1 else 0 end;\n',
    E'    -- whole elevens only; fewer than eleven wait in Reserve\n    k := n / 11;\n');
  nb := replace(nb, E'       limit least(n, k * 11)\n', E'       limit k * 11\n');
  nb := replace(nb,
    E'      -- 195: the last squad of a 5-10 remainder takes only the remainder\n'
    || E'      while (select count(*) from public.squad_members m where m.squad_id = squad_ids[idx + 1] and m.left_at is null)\n'
    || E'            >= case when idx = k - 1 and n < k * 11 then n - (k - 1) * 11 else 11 end loop\n'
    || E'        idx := (idx + 1) % k;\n'
    || E'      end loop;\n', '');
  execute nb;
end $do$;
drop function if exists public.my_reserve_status();
notify pgrst, 'reload schema';
commit;
