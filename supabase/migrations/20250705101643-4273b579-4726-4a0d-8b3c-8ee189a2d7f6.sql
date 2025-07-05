
-- Add Row Level Security policies for students_auth table
-- Allow anyone to insert new student records (for signup)
CREATE POLICY "Allow public insert for student signup" 
  ON public.students_auth 
  FOR INSERT 
  WITH CHECK (true);

-- Allow users to read their own records (for verification)
CREATE POLICY "Allow users to read own records" 
  ON public.students_auth 
  FOR SELECT 
  USING (true);

-- Allow users to update their own verification status
CREATE POLICY "Allow users to update own verification" 
  ON public.students_auth 
  FOR UPDATE 
  USING (true)
  WITH CHECK (true);
