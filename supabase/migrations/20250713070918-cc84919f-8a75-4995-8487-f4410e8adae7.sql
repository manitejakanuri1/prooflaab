-- Insert a new Flutter dashboard task for user mohan.padavala@gmail.com
INSERT INTO public.tasks (
  student_id,
  title,
  description,
  due_date,
  duration_days,
  xp_reward,
  status
)
SELECT 
  sp.id,
  'Generate frontend UI a dashboard using flutter',
  'Create a comprehensive dashboard UI using Flutter framework. The dashboard should include navigation, data visualization widgets, user interface components, and responsive design. Include proper state management and clean architecture patterns.',
  NOW() + INTERVAL '14 days',
  14,
  120,
  'Pending'
FROM public.student_profiles sp
WHERE sp.email = 'mohan.padavala@gmail.com';