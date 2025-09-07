-- Clean up all user data except mohan.padavala@gmail.com
DELETE FROM student_profiles WHERE email != 'mohan.padavala@gmail.com';
DELETE FROM college_profiles WHERE user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM startup_profiles WHERE user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM colleges WHERE email != 'mohan.padavala@gmail.com';
DELETE FROM startups WHERE email != 'mohan.padavala@gmail.com';
DELETE FROM students WHERE email != 'mohan.padavala@gmail.com';
DELETE FROM user_roles WHERE user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM notifications WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM startup_notifications WHERE startup_user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM task_applications WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM proof_uploads WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM tasks WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
) AND created_by_startup_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM trust_scores WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM xp_logs WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM activity_logs WHERE user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM user_preferences WHERE user_id NOT IN (
  SELECT id FROM auth.users WHERE email = 'mohan.padavala@gmail.com'
);
DELETE FROM student_portfolios WHERE student_id NOT IN (
  SELECT id FROM student_profiles WHERE email = 'mohan.padavala@gmail.com'
);

-- Create admin role for mohan.padavala@gmail.com if user exists
INSERT INTO user_roles (user_id, role, has_completed_wizard)
SELECT id, 'admin'::app_role, true
FROM auth.users 
WHERE email = 'mohan.padavala@gmail.com'
ON CONFLICT (user_id, role) DO UPDATE SET has_completed_wizard = true;