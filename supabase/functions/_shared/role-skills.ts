// Static required-skills-per-role lookup — hardcoded on purpose, not LLM-inferred,
// so the same role always yields the same required-skill list run to run.
// Unlisted/custom roles (student typed something outside this list) return null
// and the caller skips skill-gap classification rather than guessing.
export const ROLE_REQUIRED_SKILLS: Record<string, string[]> = {
  "Java Developer": ["Core Java", "OOP", "Collections", "Multithreading", "Spring Boot", "REST APIs", "JUnit", "SQL", "Microservices"],
  "Frontend Developer": ["HTML", "CSS", "JavaScript", "React", "TypeScript", "Responsive Design", "Git", "REST APIs", "State Management"],
  "Backend Developer": ["Node.js", "REST APIs", "SQL", "Database Design", "Authentication", "API Security", "Caching", "Microservices", "Git"],
  "Full Stack Developer": ["JavaScript", "React", "Node.js", "REST APIs", "SQL", "Git", "Authentication", "Deployment", "System Design"],
  "Software Engineer": ["Data Structures", "Algorithms", "OOP", "Git", "System Design", "Testing", "SQL", "Problem Solving"],
  "Data Analyst": ["SQL", "Excel", "Python", "Data Visualization", "Statistics", "Power BI", "Data Cleaning", "Reporting"],
  "Data Scientist": ["Python", "Statistics", "Machine Learning", "Pandas", "SQL", "Data Visualization", "Model Evaluation", "Feature Engineering"],
  "AI/ML Engineer": ["Python", "Machine Learning", "Deep Learning", "Model Deployment", "TensorFlow", "PyTorch", "Data Preprocessing", "MLOps"],
  "Cloud Engineer": ["AWS", "Networking", "Linux", "Terraform", "CI/CD", "Docker", "Kubernetes", "Monitoring"],
  "DevOps Engineer": ["CI/CD", "Docker", "Kubernetes", "Linux", "Scripting", "Cloud Platforms", "Monitoring", "Git"],
  "Cybersecurity Analyst": ["Networking", "Security Fundamentals", "Threat Analysis", "SIEM Tools", "Linux", "Vulnerability Assessment", "Cryptography"],
  "Mobile App Developer": ["Kotlin", "Swift", "Mobile UI Design", "REST APIs", "State Management", "Git", "App Lifecycle", "Testing"],
  "QA Engineer": ["Manual Testing", "Test Case Design", "Automation Testing", "Selenium", "SQL", "Bug Tracking", "API Testing"],
  "UI/UX Developer": ["Figma", "Wireframing", "User Research", "HTML", "CSS", "Design Systems", "Prototyping", "Accessibility"],
};

interface SkillGap {
  verified: string[];
  needs_improvement: string[];
  missing: string[];
}

const normalize = (s: string) => s.trim().toLowerCase();

// Loose match — resume skills are free text ("Spring", "spring boot framework"),
// so containment either direction beats requiring an exact string match.
function skillPresent(resumeSkills: string[], required: string): boolean {
  const req = normalize(required);
  return resumeSkills.some((s) => {
    const skill = normalize(s);
    return skill === req || skill.includes(req) || req.includes(skill);
  });
}

// weakTopics = text blobs (question prompts) tied to answers the student scored
// low on — used to tell "claimed and verified" apart from "claimed but shaky".
export function classifySkillGap(role: string | null | undefined, resumeSkills: string[], weakTopics: string[]): SkillGap | null {
  const required = role ? ROLE_REQUIRED_SKILLS[role] : null;
  if (!required) return null;

  const weakText = weakTopics.map(normalize).join(' | ');
  const gap: SkillGap = { verified: [], needs_improvement: [], missing: [] };

  for (const skill of required) {
    if (!skillPresent(resumeSkills, skill)) {
      gap.missing.push(skill);
    } else if (weakText.includes(normalize(skill))) {
      gap.needs_improvement.push(skill);
    } else {
      gap.verified.push(skill);
    }
  }
  return gap;
}
