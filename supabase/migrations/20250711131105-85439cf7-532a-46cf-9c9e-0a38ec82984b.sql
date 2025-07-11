-- Insert a sample task for user mohan.padavala@gmail.com for testing
INSERT INTO public.tasks (
  student_id,
  title,
  description,
  due_date,
  status,
  xp_reward,
  xp
)
SELECT 
  sp.id,
  'Build React Dashboard',
  'Design and build a functional student dashboard using React.js and Tailwind CSS. Include components for task management, progress tracking, and user profile.',
  '2025-12-15T23:59:59.000Z',
  'Pending',
  150,
  150
FROM public.student_profiles sp
WHERE sp.email = 'mohan.padavala@gmail.com';