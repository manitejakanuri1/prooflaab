-- Clean up test accounts, keeping only mohan.padavala@gmail.com
-- Delete from related tables first to avoid foreign key constraints

-- Delete notifications for test students
DELETE FROM public.notifications 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete XP logs for test students
DELETE FROM public.xp_logs 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete trust scores for test students
DELETE FROM public.trust_scores 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete student portfolios for test students
DELETE FROM public.student_portfolios 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete task applications for test students
DELETE FROM public.task_applications 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete proof uploads for test students
DELETE FROM public.proof_uploads 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete tasks assigned to test students
DELETE FROM public.tasks 
WHERE student_id IN (
  SELECT id FROM public.student_profiles 
  WHERE email != 'mohan.padavala@gmail.com'
);

-- Delete activity logs for test users
DELETE FROM public.activity_logs 
WHERE user_id NOT IN (
  SELECT user_id FROM public.student_profiles 
  WHERE email = 'mohan.padavala@gmail.com'
  UNION
  SELECT user_id FROM public.startups 
  WHERE email = 'mohan.padavala@gmail.com'
  UNION  
  SELECT user_id FROM public.colleges 
  WHERE email = 'mohan.padavala@gmail.com'
);

-- Delete user preferences for test users
DELETE FROM public.user_preferences 
WHERE user_id NOT IN (
  SELECT user_id FROM public.student_profiles 
  WHERE email = 'mohan.padavala@gmail.com'
  UNION
  SELECT user_id FROM public.startups 
  WHERE email = 'mohan.padavala@gmail.com'
  UNION
  SELECT user_id FROM public.colleges 
  WHERE email = 'mohan.padavala@gmail.com'
);

-- Delete email verification records for test emails
DELETE FROM public.email_verifications 
WHERE email != 'mohan.padavala@gmail.com';

-- Delete student OTP records for test emails
DELETE FROM public.student_otps 
WHERE email != 'mohan.padavala@gmail.com';

-- Delete student auth records for test emails
DELETE FROM public.students_auth 
WHERE email != 'mohan.padavala@gmail.com';

-- Finally, delete the main profile records
DELETE FROM public.student_profiles 
WHERE email != 'mohan.padavala@gmail.com';

DELETE FROM public.startups 
WHERE email != 'mohan.padavala@gmail.com';

DELETE FROM public.colleges 
WHERE email != 'mohan.padavala@gmail.com';