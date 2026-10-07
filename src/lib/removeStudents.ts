/**
 * Removal cannot be undone: the Google login is deleted and the database cascades
 * the student's work away. remove_students() keeps a record (profile, contact,
 * tasks, submissions, voice, tracks, levels, scorecards, squad) but there is no
 * restore tool, and XP history, badges, weekly scores, resume claims, interventions
 * and shortlists are not in it. So the person types the word REMOVE, not just OK.
 */
export function confirmRemoval(label: string): boolean {
  const typed = window.prompt(
    `Remove ${label}?\n\nThis CANNOT be undone: their login and all their work on ProofLab are deleted. ` +
    `Only a partial record is kept for audit; it cannot be restored from the app. ` +
    `To stop someone using ProofLab for now, use Suspend instead.\n\nType REMOVE to confirm.`,
  );
  return typed?.trim() === "REMOVE";
}

/**
 * Removes students completely: their ProofLab data and their Google login,
 * with a partial record kept first (accounts/ service + remove_students() in the
 * database). A college can remove only its own students; an admin any.
 */
export async function removeStudents(studentIds: string[]): Promise<{ removed: number; loginFailures: number }> {
  const res = await fetch("/api/accounts/remove", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      student_ids: studentIds,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not remove the student.");
  return { removed: json.removed ?? 0, loginFailures: (json.login_failures ?? []).length };
}
