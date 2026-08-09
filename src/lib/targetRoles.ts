// Mirrors the role names in supabase/functions/_shared/role-skills.ts (server
// keeps the full skill-requirement map; client only needs the picker labels).
export const TARGET_ROLES = [
  "Java Developer",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Software Engineer",
  "Data Analyst",
  "Data Scientist",
  "AI/ML Engineer",
  "Cloud Engineer",
  "DevOps Engineer",
  "Cybersecurity Analyst",
  "Mobile App Developer",
  "QA Engineer",
  "UI/UX Developer",
  "Other",
];

/** Picked once at onboarding and then locked. */
export const MAX_TARGET_ROLES = 3;

/**
 * Which level-track interest bucket a target role enrols them on. Several
 * roles share a track deliberately (a Java Developer and a Frontend Developer
 * both start on the same web-development path — they diverge later, not on
 * day one). "Other" and "QA Engineer" have no dedicated path yet, so they
 * fall back to the track picker instead of guessing one.
 */
export const TARGET_ROLE_TO_INTEREST: Record<string, string | null> = {
  "Java Developer": "Web Development",
  "Frontend Developer": "Web Development",
  "Backend Developer": "Web Development",
  "Full Stack Developer": "Web Development",
  "Software Engineer": "Web Development",
  "Data Analyst": "Data Science",
  "Data Scientist": "Data Science",
  "AI/ML Engineer": "Machine Learning",
  "Cloud Engineer": "Cloud Computing",
  "DevOps Engineer": "DevOps",
  "Cybersecurity Analyst": "Cybersecurity",
  "Mobile App Developer": "Mobile Development",
  "QA Engineer": null,
  "UI/UX Developer": "UI/UX Design",
  "Other": null,
};
