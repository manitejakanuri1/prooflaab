/**
 * The shapes the recruiter screens render.
 *
 * Written first against mock data, kept unchanged when the data became real —
 * src/recruiter/data.ts now fills them from the database. Keeping the shapes
 * rather than rewriting the screens is why the two halves met without a
 * rewrite.
 */

export interface ProofItem { type: 'assessment' | 'project' | 'task' | 'voice' | 'cert'; title: string; detail: string; date: string; score?: number; url?: string }
export interface SkillScore { name: string; score: number; verified: boolean; assessments: number; proof: ProofItem[] }
export interface Candidate {
  id: string
  name: string
  branch: string
  education: string
  initials: string
  avatarColor: string
  roleFit: string[]
  certifications: { name: string; issuer: string; date: string; verified: boolean }[]
  projects: { name: string; description: string; tech: string[]; stars: number; url: string }[]
  skills: SkillScore[]
  assessmentScores: { category: string; score: number; proof: ProofItem[] }[]
  dailyTasks: { date: string; task: string; status: 'completed' | 'pending' | 'missed'; score?: number }[]
  voiceExplanations: { id: string; topic: string; duration: string; date: string; transcript: string }[]
  streak: number
  consistency: number
  lastActive: string
  lastActiveDays: number
  communicationScore: number
  squad: { squadName: string; rank: number; totalMembers: number; seasonPoints: number; wins: number; losses: number }
  seasonRank: number
  sponsoredTasks: { id: string; title: string; description: string; status: 'pending' | 'in_progress' | 'submitted' | 'reviewed'; createdDate: string; deadline: string; outcome?: 'continue' | 'reject' | 'another_round' | 'interested'; reviewNotes?: string; submittedDate?: string }[]
  recommended: boolean
  shortlisted: boolean
  notes?: string
  /** Only on the full profile, and only once the student has accepted. */
  contactUnlocked?: boolean
  contact?: { email: string; phone: string | null;
              github: string | null; linkedin: string | null } | null
}
