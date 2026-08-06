
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface PortfolioProject {
  id: string;
  task_id: string;
  submitted_at: string;
  status: string;
  file_url: string | null;
  file_path: string | null;
  file_name: string | null;
  submission_notes: string | null;
  ai_summary: string | null;
  reflection_answers: any;
  post_id: string | null;
  task: {
    title: string;
    description: string | null;
    xp_reward: number;
    required_skills: string[] | null;
  } | null;
}

export const usePortfolioProjects = (studentId: string) => {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      if (!studentId) {
        setLoading(false);
        setProjects([]);
        return;
      }

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
            file_path,
            file_name,
            submission_notes,
            ai_summary,
            reflection_answers,
            tasks!inner(
              title,
              description,
              xp_reward,
              required_skills
            )
          `)
          .eq('student_id', studentId)
          .eq('status', 'Verified')
          .eq('is_public', true)
          .order('submitted_at', { ascending: false });

        if (fetchError) throw fetchError;

        // Fetch associated post IDs for each proof
        const proofIds = data?.map(d => d.id) || [];
        let postMap: Record<string, string> = {};
        
        if (proofIds.length > 0) {
          const { data: posts } = await supabase
            .from('proof_posts')
            .select('id, proof_id')
            .in('proof_id', proofIds);
          
          if (posts) {
            postMap = posts.reduce((acc, post) => {
              if (post.proof_id) acc[post.proof_id] = post.id;
              return acc;
            }, {} as Record<string, string>);
          }
        }

        const formattedProjects = data.map(item => ({
          id: item.id,
          task_id: item.task_id,
          submitted_at: item.submitted_at,
          status: item.status || 'Under Review',
          file_url: item.file_url,
          file_path: item.file_path,
          file_name: item.file_name,
          submission_notes: item.submission_notes,
          ai_summary: item.ai_summary,
          reflection_answers: item.reflection_answers,
          post_id: postMap[item.id] || null,
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
