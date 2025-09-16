-- Clean up existing duplicate notifications
DELETE FROM notifications a USING (
  SELECT MIN(ctid) as ctid, student_id, type, message, created_at
  FROM notifications 
  WHERE created_at > now() - interval '1 day'
  GROUP BY student_id, type, message, created_at
  HAVING COUNT(*) > 1
) b
WHERE a.student_id = b.student_id 
  AND a.type = b.type 
  AND a.message = b.message 
  AND a.created_at = b.created_at 
  AND a.ctid <> b.ctid;