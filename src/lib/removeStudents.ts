import { currentAccessToken } from "@/integrations/google/identity";

const ACCOUNTS_URL = import.meta.env.VITE_ACCOUNTS_URL as string;

/**
 * Removes students completely: their ProofLab data and their Google login,
 * with a backup row kept first (accounts/ service + remove_students() in the
 * database). A college can remove only its own students; an admin any.
 */
export async function removeStudents(studentIds: string[]): Promise<{ removed: number; loginFailures: number }> {
  const token = await currentAccessToken();
  const res = await fetch(`${ACCOUNTS_URL}/remove`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ student_ids: studentIds }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not remove the student.");
  return { removed: json.removed ?? 0, loginFailures: (json.login_failures ?? []).length };
}
