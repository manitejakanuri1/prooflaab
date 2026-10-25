-- ROLLBACK for 133: pitch day takes pitch Lots only again.
begin;
do $$
declare
  f   constant regprocedure := 'public.next_lot_pick(uuid,date)'::regprocedure;
  def text := pg_get_functiondef(f);
begin
  def := replace(def, $n$where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch']
                                 when kind = 'pitch' then array['pitch', 'business'] else array[kind] end)
     order by (t.lot_category = kind) desc, p.own_college desc,$n$,
                      $o$where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch'] else array[kind] end)
     order by p.own_college desc,$o$);
  execute def;
  if position('array[''pitch'', ''business'']' in pg_get_functiondef(f)) > 0 then raise exception 'rollback 133 failed'; end if;
end $$;
commit;
