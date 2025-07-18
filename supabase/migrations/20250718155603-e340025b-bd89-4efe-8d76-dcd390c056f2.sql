-- Fix XP calculation for existing verified proofs
-- First, reset the XP to recalculate correctly
UPDATE student_profiles 
SET total_xp = 0, trust_score = 0 
WHERE id IN (
  SELECT DISTINCT student_id 
  FROM proof_uploads 
  WHERE status = 'Verified'
);

-- Clear existing XP logs from migration
DELETE FROM xp_logs WHERE source = 'Task Verification';

-- Clear trust scores
DELETE FROM trust_scores;

-- Recalculate XP and trust scores for all verified proofs
DO $$
DECLARE
    proof_record RECORD;
    task_xp INTEGER;
    current_trust INTEGER;
BEGIN
    FOR proof_record IN 
        SELECT pu.student_id, pu.task_id, t.xp_reward, t.xp
        FROM proof_uploads pu
        JOIN tasks t ON t.id = pu.task_id
        WHERE pu.status = 'Verified'
        ORDER BY pu.submitted_at ASC
    LOOP
        -- Get XP from task
        task_xp := COALESCE(proof_record.xp_reward, proof_record.xp, 0);
        
        -- Get current trust score
        SELECT trust_score INTO current_trust
        FROM student_profiles 
        WHERE id = proof_record.student_id;
        
        -- Update student profile with cumulative XP and trust score
        UPDATE student_profiles 
        SET 
            total_xp = total_xp + task_xp,
            trust_score = LEAST(current_trust + 10, 100),
            updated_at = now()
        WHERE id = proof_record.student_id;
        
        -- Log XP gain
        INSERT INTO xp_logs (student_id, xp_points, source, created_at)
        VALUES (proof_record.student_id, task_xp, 'Task Verification', now());
        
        -- Update trust scores table
        INSERT INTO trust_scores (student_id, score, last_updated)
        VALUES (proof_record.student_id, (SELECT trust_score FROM student_profiles WHERE id = proof_record.student_id), now())
        ON CONFLICT (student_id) 
        DO UPDATE SET 
            score = (SELECT trust_score FROM student_profiles WHERE id = proof_record.student_id),
            last_updated = now();
    END LOOP;
END $$;