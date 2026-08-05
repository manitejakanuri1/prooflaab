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
  'Web Development':    ['HTML/CSS', 'JavaScript', 'TypeScript', 'React', 'Tailwind', 'Node.js', 'Express', 'SQL', 'PostgreSQL', 'MongoDB', 'REST APIs', 'JWT Auth', 'Next.js', 'Vercel', 'Vue.js', 'Angular'],
  'Cloud Computing':    ['AWS', 'EC2', 'S3', 'IAM', 'VPC', 'Lambda', 'Linux', 'Networking', 'Docker', 'Terraform', 'Python', 'Bash', 'Kubernetes', 'Azure', 'GCP'],
  'Data Science':       ['Python', 'Pandas', 'NumPy', 'SQL', 'Statistics', 'Matplotlib', 'Seaborn', 'Excel', 'Power BI', 'Tableau', 'Jupyter'],
  'Machine Learning':   ['Python', 'Pandas', 'NumPy', 'SQL', 'scikit-learn', 'PyTorch', 'Linear Algebra', 'Probability', 'Feature Engineering', 'FastAPI', 'Docker', 'Transformers', 'LLM APIs', 'RAG', 'TensorFlow'],
  'Mobile Development': ['Kotlin', 'Jetpack Compose', 'Swift', 'SwiftUI', 'Flutter', 'Dart', 'REST APIs', 'JSON', 'Room', 'SQLite', 'Firebase', 'App Store Publishing', 'Java', 'React Native'],
  'Cybersecurity':      ['Linux', 'Networking', 'Windows', 'Active Directory', 'Splunk', 'Wazuh', 'Log Analysis', 'Wireshark', 'Nmap', 'Burp Suite', 'Python', 'OWASP Top 10', 'Security+'],
  'UI/UX Design':       ['Figma', 'Auto Layout', 'Design Systems', 'Wireframing', 'Prototyping', 'User Research', 'Usability Testing', 'Accessibility (WCAG)', 'HTML/CSS'],
  'DevOps':             ['Linux', 'Bash', 'Python', 'Docker', 'Kubernetes', 'Git', 'CI/CD', 'GitHub Actions', 'Terraform', 'Prometheus', 'Grafana', 'AWS', 'Jenkins'],
  'IoT':                ['C', 'C++', 'ESP32', 'STM32', 'I2C/SPI/UART', 'FreeRTOS', 'MQTT', 'Sensors', 'Circuits/PCB', 'Python'],
  'Game Development':   ['Unity', 'C#', 'Unreal', 'C++', '3D Maths', 'Physics', 'Blender'],
  'Blockchain':         ['Solidity', 'Foundry', 'Hardhat', 'ethers.js', 'viem', 'EVM Internals', 'Smart Contract Security', 'React', 'JavaScript'],
  'Robotics':           ['Python', 'C++', 'ROS 2', 'Control Systems', 'OpenCV', 'Embedded Systems', 'Gazebo', 'Linear Algebra'],
};

/** Expected on every track, so they are offered alongside each interest's own set. */
export const CORE_SKILLS = ['Git & GitHub', 'DSA', 'Linux Basics'];

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

    // Collected whether or not the interest is covered. Covering a track with
    // two skills does not mean there is nothing left to learn, and the review
    // screen has a "Worth adding next" list for exactly this case — which never
    // rendered while this was gated on !covered, so a student whose picks lined
    // up was shown nothing to aim at. Only the "There's a gap here" wording is
    // conditional; the list itself is useful either way.
    missing.slice(0, 6).forEach((m) => allMissing.add(m));
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
