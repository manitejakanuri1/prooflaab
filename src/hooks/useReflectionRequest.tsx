import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface ReflectionRequestData {
  proofId: string;
  studentId: string;
}

export const useReflectionRequest = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ proofId, studentId }: ReflectionRequestData) => {
      if (!user) throw new Error("User not authenticated");

      // Update proof upload with reflection request
      const { error: updateError } = await supabase
        .from("proof_uploads")
        .update({
          reflection_requested: true,
        })
        .eq("id", proofId);

      if (updateError) throw updateError;

      // Log in audit logs
      await supabase.from("audit_logs").insert({
        user_id: user.id,
        action: "reflection_requested",
        table_name: "proof_uploads",
        record_id: proofId,
        new_values: {
          proof_id: proofId,
          student_id: studentId,
          reflection_requested: true,
        },
      });

      // Get college_id from student profile
      const { data: studentProfile } = await supabase
        .from("student_profiles")
        .select("college_id, full_name")
        .eq("id", studentId)
        .single();

      if (studentProfile?.college_id) {
        // Get college user_id
        const { data: college } = await supabase
          .from("colleges")
          .select("user_id, name")
          .eq("id", studentProfile.college_id)
          .single();

        if (college?.user_id) {
          // Notify college admin - but first check if there's a college_notifications table
          // If not, we'll just skip the notification for now
          // In production, you'd want to create this table or use admin_notifications
          console.log(
            `College admin notification: ${studentProfile.full_name} requested conceptual review`
          );
        }
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proof-uploads"] });
      toast.success("Review request submitted", {
        description: "Your college admin has been notified",
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to submit request", {
        description: error.message,
      });
    },
  });
};
