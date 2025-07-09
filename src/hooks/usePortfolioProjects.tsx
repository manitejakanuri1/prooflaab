
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface PortfolioProject {
  id: string;
  task_id: string;
  submitted_at: string;
  status: string;
  file_url: string | null;
  submission_notes: string | null;
  task: {
    title: string;
    description: string | null;
    xp_reward: number;
  } | null;
}

export const usePortfolioProjects = (studentId: string) => {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      if (!studentId) return;

      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('proof_uploads')
          .select(`
            id,
            task_id,
            submitted_at,
            status,
            file_url,
            submission_notes,
            tasks!inner(
              title,
              description,
              xp_reward
            )
          `)
          .eq('student_id', studentId)
          .order('submitted_at', { ascending: false });

        if (fetchError) throw fetchError;

        const formattedProjects = data.map(item => ({
          id: item.id,
          task_id: item.task_id,
          submitted_at: item.submitted_at,
          status: item.status || 'Under Review',
          file_url: item.file_url,
          submission_notes: item.submission_notes,
          task: Array.isArray(item.tasks) ? item.tasks[0] : item.tasks
        }));

        setProjects(formattedProjects);
      } catch (err) {
        console.error('Error fetching portfolio projects:', err);
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [studentId]);

  return { projects, loading, error };
};
