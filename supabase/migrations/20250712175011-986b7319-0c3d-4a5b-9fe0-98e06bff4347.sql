-- Insert a new task for user mohan.padavala@gmail.com
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
  'Create a Login Form using Python or Java',
  'Create a login form application using either Python or Java. For Python, you can use tkinter for GUI or Flask/Django for web-based forms. For Java, you can use Swing/JavaFX for desktop or Spring Boot for web. Include username and password fields, basic validation, error handling, and user feedback. Add proper form styling and ensure secure password handling.',
  NOW() + INTERVAL '10 days',
  10,
  75,
  'Pending'
FROM public.student_profiles sp
WHERE sp.email = 'mohan.padavala@gmail.com';