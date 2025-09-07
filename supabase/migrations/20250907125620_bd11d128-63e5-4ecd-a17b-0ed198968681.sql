-- Delete all records for user 'info.yuvasakhi@gmail.com' (ID: 31edc9b2-3f2f-4570-8136-1e296fb266f6)
-- First delete audit logs to avoid foreign key constraint violation

-- Delete from audit_logs table first
DELETE FROM audit_logs WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';

-- Delete from user_roles table
DELETE FROM user_roles WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';

-- Delete from related tables that might have this user_id
DELETE FROM activity_logs WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM college_profiles WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM colleges WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM startup_profiles WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM startups WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM students WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';
DELETE FROM user_preferences WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';

-- Delete from student_profiles table
DELETE FROM student_profiles WHERE user_id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';

-- Delete from email-related tables
DELETE FROM email_verifications WHERE email = 'info.yuvasakhi@gmail.com';
DELETE FROM students_auth WHERE email = 'info.yuvasakhi@gmail.com';
DELETE FROM student_otps WHERE email = 'info.yuvasakhi@gmail.com';

-- Delete from invite codes where used_by or created_by matches
DELETE FROM invite_codes WHERE used_by = '31edc9b2-3f2f-4570-8136-1e296fb266f6' OR created_by = '31edc9b2-3f2f-4570-8136-1e296fb266f6';

-- Finally, delete from auth.users table
DELETE FROM auth.users WHERE id = '31edc9b2-3f2f-4570-8136-1e296fb266f6';