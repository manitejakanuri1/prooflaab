export function taskMatchesSkill(
  task: { title: string; category?: string | null; skills?: string[] },
  skillName: string
): boolean {
  const norm = (str: string) => str.toLowerCase().replace(/[\s._-]/g, "");
  const target = norm(skillName);
  if (!target) return false;
  if (task.category && norm(task.category).includes(target)) return true;
  if (task.skills && task.skills.some((sk) => norm(sk) === target || norm(sk).includes(target))) return true;
  if (norm(task.title).includes(target)) return true;
  return false;
}
