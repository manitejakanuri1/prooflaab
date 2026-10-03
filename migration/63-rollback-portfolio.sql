-- Rollback of 63: removes portfolio_work(). Re-deploy the previous website build first (the portfolio pages call it).
drop function if exists public.portfolio_work(uuid);
notify pgrst, 'reload schema';
