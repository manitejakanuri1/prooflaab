import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * A spoken explanation is evidence about a submission, so there must be one.
 * The database refuses a recording without it (migration 61); asking first
 * saves the student from recording 60 seconds that cannot be saved.
 */
export async function explainIfSubmitted(taskId: string, open: () => void) {
  const { count, error } = await supabase.from("task_submissions")
    .select("id", { count: "exact", head: true }).eq("task_id", taskId);
  if (!error && (count ?? 0) === 0) {
    toast({ title: "Submit your work first", description: "Then explain what you submitted, in your own words." });
    return;
  }
  open();   // on a read error, let the server decide
}
