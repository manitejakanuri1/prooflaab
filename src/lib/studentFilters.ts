/**
 * Student filtering for the two "assign tasks" screens.
 *
 * The admin screen and the college screen were built by copying one into the
 * other, so they each carried their own identical copy of this. A filter fixed
 * on one screen stayed broken on the other. This is the one copy.
 */

export interface FilterableStudent {
  id: string;
  branch?: string | null;
  year_of_study?: string | null;
  trust_score?: number | null;
  preferred_skills?: string[] | null;
  college_id?: string | null;
}

export interface StudentFilterCriteria {
  branch?: string;
  year?: string;
  /** Kept as the raw text the input holds; "" means no bound. */
  trustScoreMin?: string;
  trustScoreMax?: string;
  skills?: string[];
}

/** The sentinel the Select components use for "no filter". */
const ALL_BRANCHES = "all-branches";
const ALL_YEARS = "all-years";

export function filterStudents<T extends FilterableStudent>(
  students: T[],
  { branch, year, trustScoreMin, trustScoreMax, skills = [] }: StudentFilterCriteria,
): T[] {
  let filtered = [...students];

  if (branch && branch !== ALL_BRANCHES) {
    filtered = filtered.filter((s) => s.branch === branch);
  }
  if (year && year !== ALL_YEARS) {
    filtered = filtered.filter((s) => s.year_of_study === year);
  }
  if (trustScoreMin) {
    filtered = filtered.filter((s) => (s.trust_score ?? 0) >= parseInt(trustScoreMin));
  }
  if (trustScoreMax) {
    filtered = filtered.filter((s) => (s.trust_score ?? 0) <= parseInt(trustScoreMax));
  }
  if (skills.length > 0) {
    filtered = filtered.filter((s) =>
      s.preferred_skills?.some((skill) =>
        skills.some((f) => skill.toLowerCase().includes(f.toLowerCase())),
      ),
    );
  }

  return filtered;
}

/**
 * Only the admin screen can target specific colleges, so that step stays
 * separate rather than being a flag the college screen always passes as false.
 */
export function filterStudentsByColleges<T extends FilterableStudent>(
  students: T[],
  collegeIds: string[],
): T[] {
  if (collegeIds.length === 0) return students;
  return students.filter((s) => s.college_id && collegeIds.includes(s.college_id));
}
