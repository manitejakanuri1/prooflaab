-- Insert a new task for user info.yuvasakhi@gmail.com
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
  'Create a form using python',
  'Create a form application using Python. You can use tkinter for a desktop GUI form or Flask/Django for a web-based form. The form should include various input fields (text, email, password, dropdown, checkboxes, radio buttons), form validation, error handling, and data submission. Include proper styling and user feedback messages. For web forms, ensure proper CSRF protection and sanitization.',
  NOW() + INTERVAL '10 days',
  10,
  80,
  'Pending'
FROM public.student_profiles sp
WHERE sp.email = 'info.yuvasakhi@gmail.com';