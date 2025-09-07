-- Create test invite codes for each user role to enable proper testing
-- These codes will be valid for 7 days

INSERT INTO invite_codes (code, role, expires_at, is_used, created_by)
VALUES 
  ('STU001', 'student', now() + interval '7 days', false, 'bb0c1efd-7d00-4ef7-b157-db6573c68363'),
  ('COL001', 'college_admin', now() + interval '7 days', false, 'bb0c1efd-7d00-4ef7-b157-db6573c68363'),
  ('START1', 'startup', now() + interval '7 days', false, 'bb0c1efd-7d00-4ef7-b157-db6573c68363'),
  ('ADM001', 'admin', now() + interval '7 days', false, 'bb0c1efd-7d00-4ef7-b157-db6573c68363');