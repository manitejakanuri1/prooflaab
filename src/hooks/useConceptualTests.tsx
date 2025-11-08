import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ConceptualTest {
  id: string;
  proof_id: string;
  status: 'pending' | 'submitted' | 'graded';
  questions: any[];
  student_answers: any[];
  task_id?: string;
}

export const useConceptualTests = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['student-conceptual-tests', user?.id],
    queryFn: async () => {
      if (!user?.id) return {};

      // Get student profile
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return {};

      // Fetch all conceptual tests for student's proof uploads
      const { data, error } = await supabase
        .from('conceptual_tests')
        .select(`
          *,
          proof_uploads!inner (
            task_id,
            student_id
          )
        `)
        .eq('proof_uploads.student_id', profile.id);

      if (error) {
        console.error('Error fetching conceptual tests:', error);
        return {};
      }

      // Create a map of task_id -> test data
      const testsMap: Record<string, ConceptualTest & { proof_id: string }> = {};
      data?.forEach((item: any) => {
        const test = item as ConceptualTest;
        const taskId = item.proof_uploads?.task_id;
        if (taskId) {
          testsMap[taskId] = {
            ...test,
            task_id: taskId,
            proof_id: test.proof_id
          };
        }
      });

      return testsMap;
    },
    enabled: !!user?.id,
  });
};
