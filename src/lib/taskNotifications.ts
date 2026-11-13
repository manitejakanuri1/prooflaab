import { supabase } from "@/integrations/supabase/client";

/**
 * S3 (13 Nov 2026): When a student submits a task again after changes were asked,
 * update the old "Nimbus asked for changes" notification to "You sent it again: <Status>"
 * and mark it as read.
 */
export async function syncResubmittedNotification(userId: string | undefined, taskId: string, status: string): Promise<void> {
  if (!userId || !taskId) return;
  const statusText = status === "passed" ? "Passed" : status.charAt(0).toUpperCase() + status.slice(1);
  const newText = `You sent it again: ${statusText}`;

  try {
    const { data: notices } = await supabase
      .from("notifications")
      .select("id, title, link")
      .eq("user_id", userId)
      .ilike("title", "%asked for changes%");

    const toUpdate = (notices ?? []).filter((n) => n.link?.includes(taskId));
    for (const n of toUpdate) {
      await supabase
        .from("notifications")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          title: newText,
          message: newText,
        })
        .eq("id", n.id);
    }
  } catch (err) {
    console.error("Failed to sync resubmitted notification:", err);
  }
}
