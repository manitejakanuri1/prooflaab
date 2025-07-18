-- Create function to update student XP and trust score when proof is verified
CREATE OR REPLACE FUNCTION update_student_scores()
RETURNS TRIGGER AS $$
DECLARE
    task_xp INTEGER;
BEGIN
    -- Only process when status changes to 'Verified'
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Verified' THEN
        -- Get XP from the task
        SELECT COALESCE(xp_reward, xp, 0) INTO task_xp 
        FROM tasks 
        WHERE id = NEW.task_id;
        
        -- Update student's total XP and trust score
        UPDATE student_profiles 
        SET 
            total_xp = total_xp + task_xp,
            trust_score = LEAST(trust_score + 10, 100),  -- Increase trust score by 10, max 100
            updated_at = now()
        WHERE id = NEW.student_id;
        
        -- Log the XP gain
        INSERT INTO xp_logs (student_id, xp_points, source, created_at)
        VALUES (NEW.student_id, task_xp, 'Task Verification', now());
        
        -- Update trust score table
        INSERT INTO trust_scores (student_id, score, last_updated)
        VALUES (NEW.student_id, (SELECT trust_score FROM student_profiles WHERE id = NEW.student_id), now())
        ON CONFLICT (student_id) 
        DO UPDATE SET 
            score = (SELECT trust_score FROM student_profiles WHERE id = NEW.student_id),
            last_updated = now();
            
        -- Mark task as completed
        UPDATE tasks 
        SET 
            status = 'Completed',
            completed_at = now(),
            updated_at = now()
        WHERE id = NEW.task_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for proof verification
DROP TRIGGER IF EXISTS trigger_update_student_scores ON proof_uploads;
CREATE TRIGGER trigger_update_student_scores
    AFTER UPDATE ON proof_uploads
    FOR EACH ROW
    EXECUTE FUNCTION update_student_scores();

-- Also update existing verified proofs to backfill scores
DO $$
DECLARE
    proof_record RECORD;
    task_xp INTEGER;
BEGIN
    FOR proof_record IN 
        SELECT pu.student_id, pu.task_id, t.xp_reward, t.xp
        FROM proof_uploads pu
        JOIN tasks t ON t.id = pu.task_id
        WHERE pu.status = 'Verified'
    LOOP
        -- Get XP from task
        task_xp := COALESCE(proof_record.xp_reward, proof_record.xp, 0);
        
        -- Update student profile if not already updated
        UPDATE student_profiles 
        SET 
            total_xp = total_xp + task_xp,
            trust_score = LEAST(trust_score + 10, 100),
            updated_at = now()
        WHERE id = proof_record.student_id 
        AND NOT EXISTS (
            SELECT 1 FROM xp_logs 
            WHERE student_id = proof_record.student_id 
            AND source = 'Task Verification'
            AND created_at > (SELECT submitted_at FROM proof_uploads WHERE student_id = proof_record.student_id AND task_id = proof_record.task_id LIMIT 1)
        );
        
        -- Log XP if not already logged
        INSERT INTO xp_logs (student_id, xp_points, source, created_at)
        SELECT proof_record.student_id, task_xp, 'Task Verification', now()
        WHERE NOT EXISTS (
            SELECT 1 FROM xp_logs 
            WHERE student_id = proof_record.student_id 
            AND source = 'Task Verification'
            AND created_at > (SELECT submitted_at FROM proof_uploads WHERE student_id = proof_record.student_id AND task_id = proof_record.task_id LIMIT 1)
        );
        
        -- Update trust scores table
        INSERT INTO trust_scores (student_id, score, last_updated)
        VALUES (proof_record.student_id, (SELECT trust_score FROM student_profiles WHERE id = proof_record.student_id), now())
        ON CONFLICT (student_id) 
        DO UPDATE SET 
            score = (SELECT trust_score FROM student_profiles WHERE id = proof_record.student_id),
            last_updated = now();
            
        -- Mark task as completed
        UPDATE tasks 
        SET 
            status = 'Completed',
            completed_at = now(),
            updated_at = now()
        WHERE id = proof_record.task_id AND status != 'Completed';
    END LOOP;
END $$;