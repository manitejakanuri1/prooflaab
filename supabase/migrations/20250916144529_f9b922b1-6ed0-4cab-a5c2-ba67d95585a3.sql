-- Clean up existing duplicate notifications
-- Keep only the first occurrence of each duplicate notification
DELETE FROM notifications 
WHERE id IN (
  SELECT id FROM (
    SELECT id, 
           ROW_NUMBER() OVER (
             PARTITION BY student_id, type, message, created_at 
             ORDER BY id
           ) as row_num
    FROM notifications
  ) t 
  WHERE t.row_num > 1
);