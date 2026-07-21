-- Insert a new task for Mohan Padavala
INSERT INTO public.tasks (
  student_id, 
  title, 
  description, 
  due_date, 
  duration_days, 
  xp_reward, 
  status
) VALUES (
  'e31e20b8-fcfc-4541-800e-c14197f3275b',
  'Make a simple login form using Python',
  'Create a simple login form application using Python. The form should include username and password fields with basic validation. You can use libraries like tkinter for GUI or Flask for web-based form. Include proper error handling and user feedback.',
  NOW() + INTERVAL '7 days',
  7,
  50,
  'Pending'
);