-- 133: Thursday (pitch day) falls back to a business Lot before the shared pool.
-- Staging, 22 Oct 2026: 117 Lots, only 2 of them pitch. After a student's 2 pitch Lots, Thursday fell
-- through to the shared rotation (any page). It now takes an unseen pitch Lot first, then business.
-- Rollback: migration/133-rollback-pitch-day-falls-back-to-business.sql
begin;
do $$
declare
  f   constant regprocedure := 'public.next_lot_pick(uuid,date)'::regprocedure;
  def text := pg_get_functiondef(f);
  o1 constant text := $o$where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch'] else array[kind] end)
     order by p.own_college desc,$o$;
  n1 constant text := $n$where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch']
                                 when kind = 'pitch' then array['pitch', 'business'] else array[kind] end)
     order by (t.lot_category = kind) desc, p.own_college desc,$n$;
begin
  if (length(def) - length(replace(def, o1, ''))) / length(o1) <> 1 then
    raise exception '133: next_lot_pick is not the 130 version';
  end if;
  execute replace(def, o1, n1);
end $$;
commit;
