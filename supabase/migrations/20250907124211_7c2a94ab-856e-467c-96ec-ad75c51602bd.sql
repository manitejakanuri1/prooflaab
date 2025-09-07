-- Ensure admin user has proper role setup
INSERT INTO user_roles (user_id, role, has_completed_wizard, created_by)
VALUES ('31edc9b2-3f2f-4570-8136-1e296fb266f6', 'admin', true, '31edc9b2-3f2f-4570-8136-1e296fb266f6')
ON CONFLICT (user_id, role) DO UPDATE SET
  has_completed_wizard = true,
  created_by = '31edc9b2-3f2f-4570-8136-1e296fb266f6';