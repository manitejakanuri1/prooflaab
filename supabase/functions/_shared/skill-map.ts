/**
 * Which skills actually belong to each interest.
 *
 * The match decision is made here in code rather than by the model. Asking a
 * model "do these skills fit this interest?" let it infer a role from the skills
 * and then check the skills against that role — circular, and it always agreed
 * with itself (Mobile Development + HTML/CSS came back as a match called
 * "Frontend Developer"). A lookup cannot do that, and gives the same answer for
 * the same input every time.
 *
 * The model still writes the explanation; it just no longer decides the verdict.
 */
export const INTEREST_SKILLS: Record<string, string[]> = {
  'Web Development':    ['HTML/CSS', 'JavaScript', 'TypeScript', 'React', 'Vue.js', 'Angular', 'Node.js', 'Next.js', 'PHP'],
  'Mobile Development': ['Kotlin', 'Swift', 'Java', 'Dart', 'Flutter', 'React Native', 'Firebase'],
  'Data Science':       ['Python', 'Pandas', 'NumPy', 'SQL', 'R', 'Matplotlib', 'Jupyter', 'Excel'],
  'Machine Learning':   ['Python', 'scikit-learn', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy'],
  'Cybersecurity':      ['Linux', 'Networking', 'Wireshark', 'Nmap', 'Burp Suite', 'Python', 'Cryptography'],
  'Cloud Computing':    ['AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Linux'],
  'DevOps':             ['Linux', 'Docker', 'Kubernetes', 'Git', 'CI/CD', 'Jenkins', 'Terraform', 'Bash'],
  'UI/UX Design':       ['Figma', 'Wireframing', 'Prototyping', 'Design Systems', 'User Research', 'HTML/CSS'],
  'Game Development':   ['Unity', 'Unreal', 'C#', 'C++', 'Blender'],
  'Blockchain':         ['Solidity', 'Ethereum', 'Web3.js', 'Smart Contracts', 'Cryptography', 'JavaScript'],
  'IoT':                ['C', 'C++', 'Python', 'Arduino', 'Raspberry Pi', 'MQTT', 'Embedded Systems'],
  'Robotics':           ['Python', 'C++', 'ROS', 'Arduino', 'Control Systems', 'Computer Vision'],
};

/** Job title each interest points at, so the role follows the goal not the skills. */
export const INTEREST_ROLE: Record<string, string> = {
  'Web Development': 'Web Developer',
  'Mobile Development': 'Mobile App Developer',
  'Data Science': 'Data Analyst',
  'Machine Learning': 'Machine Learning Engineer',
  'Cybersecurity': 'Security Analyst',
  'Cloud Computing': 'Cloud Engineer',
  'DevOps': 'DevOps Engineer',
  'UI/UX Design': 'UI/UX Designer',
  'Game Development': 'Game Developer',
  'Blockchain': 'Blockchain Developer',
  'IoT': 'IoT Engineer',
  'Robotics': 'Robotics Engineer',
};

/**
 * Interests with no runnable language. A coding round here would fall back to
 * Python and test something the student never claimed, so it is skipped.
 */
export const NON_CODING_INTERESTS = new Set(['UI/UX Design']);

export interface InterestVerdict {
  interest: string;
  covered: boolean;
  matched: string[];
  missing: string[];
}

export interface MatchResult {
  match: boolean;
  target_role: string;
  per_interest: InterestVerdict[];
  matched_skills: string[];
  missing_skills: string[];
  /** How many of that interest's skills a student needs before it counts as covered. */
  threshold: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '');

/**
 * An interest counts as covered by at least COVER_MIN of its own skills. One
 * loose overlap is not enough: Python alone should not make someone a Robotics
 * engineer, but Python + Pandas genuinely covers Data Science.
 */
const COVER_MIN = 2;

export function matchSkills(interests: string[], skills: string[]): MatchResult {
  const have = new Set(skills.map(norm));
  const perInterest: InterestVerdict[] = [];
  const allMatched = new Set<string>();
  const allMissing = new Set<string>();

  for (const interest of interests) {
    const required = INTEREST_SKILLS[interest] ?? [];
    const matched = required.filter((r) => have.has(norm(r)));
    const missing = required.filter((r) => !have.has(norm(r)));

    // A short skill list should not need the same count as a long one.
    const needed = Math.min(COVER_MIN, required.length);
    const covered = matched.length >= needed && matched.length > 0;

    perInterest.push({ interest, covered, matched, missing });
    matched.forEach((m) => allMatched.add(m));
    if (!covered) missing.slice(0, 6).forEach((m) => allMissing.add(m));
  }

  // Name the role after an interest they can actually back up; otherwise after
  // the first thing they chose, so the goal still leads.
  const firstCovered = perInterest.find((p) => p.covered)?.interest;
  const roleSource = firstCovered ?? interests[0];

  return {
    match: perInterest.length > 0 && perInterest.every((p) => p.covered),
    target_role: INTEREST_ROLE[roleSource] ?? roleSource ?? 'Student',
    per_interest: perInterest,
    matched_skills: [...allMatched],
    missing_skills: [...allMissing],
    threshold: COVER_MIN,
  };
}
