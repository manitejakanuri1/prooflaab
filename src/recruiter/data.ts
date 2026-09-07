import { supabase } from "@/integrations/supabase/client";
import type { Candidate, ProofItem, SkillScore } from "./types";

/**
 * The seam between the screens and the database.
 *
 * The screens were built against mock data in the shapes in types.ts. Rather
 * than rewrite them, this file fills those same shapes from the real functions
 * — so the merge was one file, not twenty.
 *
 * Everything a recruiter is not allowed to see is already absent from what the
 * database returns: a student who has not made their portfolio public never
 * appears, and email and phone are withheld until they accept a shortlist.
 * Nothing here re-checks that, because nothing here could.
 */

/** Initials and a stable colour, since the database stores neither. */
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

const PALETTE = ["#38bdf8", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6"];
const colourFor = (id: string) =>
  PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

const daysAgo = (days: number) =>
  days >= 999 ? "never" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;

/** A skill's status becomes its evidence line — the screens show proof, not labels. */
const skillProof = (s: {
  skill: string; status: string; score: number | null;
  lots: number; explanations: number; last_evidence_at: string | null;
}): ProofItem[] => {
  const out: ProofItem[] = [];
  if (s.score != null) {
    out.push({
      type: "assessment",
      title: `${s.skill} assessment`,
      detail: `Scored ${s.score}/100 in the validation assessment.`,
      date: (s.last_evidence_at ?? "").slice(0, 10),
      score: s.score,
    });
  }
  if (s.lots > 0) {
    out.push({
      type: "task",
      title: `${s.lots} piece${s.lots === 1 ? "" : "s"} of work using ${s.skill}`,
      detail: "Submitted and checked, not self-declared.",
      date: (s.last_evidence_at ?? "").slice(0, 10),
    });
  }
  if (s.explanations > 0) {
    out.push({
      type: "voice",
      title: `Explained ${s.skill} out loud`,
      detail: `${s.explanations} recording${s.explanations === 1 ? "" : "s"} of sixty seconds.`,
      date: (s.last_evidence_at ?? "").slice(0, 10),
    });
  }
  if (out.length === 0) {
    out.push({
      type: "assessment",
      title: `${s.skill} — claimed only`,
      detail: "Taken from their resume. Nothing has tested it yet.",
      date: "",
    });
  }
  return out;
};

/** One row from recruiter_talent, in the shape the Talent list renders. */
export function toCandidate(row: Record<string, unknown>): Candidate {
  const name = String(row.full_name ?? "");
  const id = String(row.student_id ?? "");
  const skills = (row.top_skills as string[] | null) ?? [];
  const proven = Number(row.skills_proven ?? 0);

  return {
    id,
    name,
    branch: String(row.branch ?? ""),
    education: [row.branch, row.batch].filter(Boolean).join(" · "),
    initials: initialsOf(name),
    avatarColor: colourFor(id),
    roleFit: row.target_role ? [String(row.target_role)] : [],
    certifications: [],
    projects: [],
    skills: skills.slice(0, 6).map((skill, i) => ({
      name: skill,
      score: Number(row.comms_score ?? 0),
      verified: i < proven,
      assessments: 0,
      proof: [],
    })),
    assessmentScores: [],
    dailyTasks: [],
    voiceExplanations: [],
    streak: 0,
    consistency: Number(row.active_weeks ?? 0),
    lastActive: daysAgo(Number(row.days_since_active ?? 999)),
    lastActiveDays: Number(row.days_since_active ?? 999),
    communicationScore: Number(row.comms_score ?? 0),
    squad: {
      squadName: String(row.squad_name ?? ""),
      rank: Number(row.squad_rank ?? 0),
      totalMembers: 11,
      seasonPoints: Number(row.season_points ?? 0),
      wins: 0,
      losses: 0,
    },
    seasonRank: Number(row.squad_rank ?? 0),
    sponsoredTasks: [],
    recommended: false,
    shortlisted: Boolean(row.shortlisted),
    notes: undefined,
  };
}

export interface Filters {
  role?: string;
  skills?: string[];
  branch?: string;
  minSkill?: number;
  minComms?: number;
  activeWithin?: number;
}

export async function loadTalent(f: Filters = {}): Promise<Candidate[]> {
  const { data, error } = await supabase.rpc("recruiter_talent", {
    _role: f.role ?? null,
    _skills: f.skills?.length ? f.skills : null,
    _branch: f.branch ?? null,
    _min_skill: f.minSkill ?? null,
    _min_comms: f.minComms ?? null,
    _active_within: f.activeWithin ?? null,
    _limit: 50,
    _offset: 0,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toCandidate);
}

export async function loadFilters() {
  const { data } = await supabase.rpc("recruiter_filters");
  return (data ?? { verified: false }) as unknown as {
    verified: boolean; branches?: string[]; roles?: string[];
    skills?: string[]; total?: number;
  };
}

export async function loadHome() {
  const { data } = await supabase.rpc("recruiter_home");
  return data as unknown as Record<string, unknown>;
}

/**
 * The full profile. Unlike the list row, this one carries the evidence — which
 * is the whole point of the screen.
 */
export async function loadProfile(studentId: string): Promise<Candidate | null> {
  const { data } = await supabase.rpc("recruiter_proof_profile", {
    _student_id: studentId,
  });
  const p = data as unknown as Record<string, any> | null;
  if (!p || p.error) return null;

  // Recording the view is bookkeeping; a failure must not blank the page.
  void supabase.rpc("recruiter_log_view", { _student_id: studentId });

  const name = String(p.full_name ?? "");
  const skills: SkillScore[] = (p.skills ?? []).map((s: any) => ({
    name: s.skill,
    score: s.score ?? 0,
    verified: s.status === "proven",
    assessments: s.score != null ? 1 : 0,
    proof: skillProof(s),
  }));

  const sc = p.scorecard ?? {};
  const assessmentScores = [
    ["Skill proof", sc.skill_proof],
    ["Project proof", sc.project_proof],
    ["Reasoning", sc.reasoning],
    ["Coding", sc.coding],
    ["Interview readiness", sc.interview_readiness],
    ["Resume quality", sc.resume_quality],
    ["ATS match", sc.ats_match],
  ]
    .filter(([, v]) => v != null)
    .map(([category, score]) => ({
      category: String(category),
      score: Number(score),
      proof: [
        {
          type: "assessment" as const,
          title: `${category}`,
          detail: "From the validation assessment taken during onboarding.",
          date: String(sc.at ?? "").slice(0, 10),
          score: Number(score),
        },
      ],
    }));

  return {
    id: String(p.id),
    name,
    branch: String(p.branch ?? ""),
    education: [p.branch, p.batch, p.year_of_study && `year ${p.year_of_study}`]
      .filter(Boolean).join(" · "),
    initials: initialsOf(name),
    avatarColor: colourFor(String(p.id)),
    roleFit: [p.target_role, ...(p.secondary_roles ?? [])].filter(Boolean),
    certifications: (p.certifications ?? []).map((c: any) => ({
      name: c.name,
      issuer: c.issuer ?? "",
      date: c.issued_on ?? "",
      verified: Boolean(c.url),
    })),
    projects: [],
    skills,
    assessmentScores,
    dailyTasks: (p.work ?? []).map((w: any) => ({
      date: String(w.submitted_at ?? "").slice(0, 10),
      task: w.title ?? "Submitted work",
      status: /verified/i.test(w.status ?? "") ? "completed" as const : "pending" as const,
      score: w.ai_score ?? undefined,
    })),
    voiceExplanations: (p.explanations ?? []).map((v: any) => ({
      id: v.id,
      topic: v.about ?? "Explanation",
      duration: v.duration_seconds ? `${v.duration_seconds}s` : "—",
      date: String(v.created_at ?? "").slice(0, 10),
      transcript: v.communication_notes ?? "",
    })),
    streak: Number(p.consistency?.current_streak ?? 0),
    consistency: Number(p.consistency?.active_weeks ?? 0),
    lastActive: daysAgo(Number(p.days_since_active ?? 999)),
    lastActiveDays: Number(p.days_since_active ?? 999),
    communicationScore: Number(p.communication ?? 0),
    squad: {
      squadName: p.squad?.name ?? "",
      rank: Number(p.squad?.rank ?? 0),
      totalMembers: 11,
      seasonPoints: Number(p.squad?.points ?? 0),
      wins: Number(String(p.squad?.record ?? "0-0-0").split("-")[0] ?? 0),
      losses: Number(String(p.squad?.record ?? "0-0-0").split("-")[2] ?? 0),
    },
    seasonRank: Number(p.squad?.rank ?? 0),
    sponsoredTasks: [],
    recommended: false,
    shortlisted: Boolean(p.shortlist),
    notes: p.shortlist?.note ?? undefined,
    contactUnlocked: Boolean(p.contact_unlocked),
    contact: p.contact ?? null,
  } as Candidate;
}

export async function shortlist(studentId: string, note?: string) {
  const { error } = await supabase.rpc("recruiter_shortlist", {
    _student_id: studentId, _note: note ?? null,
  });
  if (error) throw error;
}

export async function loadShortlist() {
  const { data } = await supabase
    .from("recruiter_shortlists")
    .select("id, student_id, note, stage, student_response, responded_at, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function loadLots() {
  const { data } = await supabase.rpc("recruiter_lots");
  return (data ?? []) as unknown as Record<string, unknown>[];
}

export async function sponsorLot(
  studentId: string, title: string, brief: string, criteria?: string, days = 7,
) {
  const { error } = await supabase.rpc("sponsor_lot", {
    _student_id: studentId, _title: title, _brief: brief,
    _criteria: criteria ?? null, _days: days,
  });
  if (error) throw error;
}

export async function recordOutcome(studentId: string, outcome: string) {
  const { error } = await supabase.rpc("record_outcome", {
    _student_id: studentId, _outcome: outcome,
  });
  if (error) throw error;
}
