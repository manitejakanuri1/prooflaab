-- Delete test users and related records
DELETE FROM user_roles WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM student_profiles WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM college_profiles WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM startup_profiles WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM colleges WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM startups WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');
DELETE FROM students WHERE user_id IN ('837ab5e6-75ad-4987-bde7-72da6db1ca09', '813af647-10f8-4601-9580-18c6d19de9b6');

-- Delete from auth.users (this will cascade to related tables due to foreign keys)
DELETE FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com');