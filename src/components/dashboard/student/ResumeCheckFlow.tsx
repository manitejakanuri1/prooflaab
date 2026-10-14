import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TARGET_ROLES } from "@/lib/targetRoles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileCheck2, Upload, X, Plus, CheckCircle2, Loader2, ClipboardList, Sparkles, Download, Award, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import TimedResumeAssessment, { ResumeScoreResult } from "./TimedResumeAssessment";
import { RoadmapStages } from "./RoadmapStages";
import { SkillGap } from "./SkillGap";
import { downloadResumeAsPdf } from "@/lib/resumePdf";
import { addDays, formatDistanceToNow } from "date-fns";

// Mirrors COOLDOWN_DAYS in supabase/functions/resume-retest-generate — used
// only to pre-disable the button before the round trip confirms it server-side.
const RETEST_COOLDOWN_DAYS = 3;

interface ProjectClaim {
  name: string;
  description: string;
  tech_stack: string[];
}

interface ResumeClaimRow {
  id: string;
  target_role: string | null;
  skills: string[];
  certifications: string[];
  projects: ProjectClaim[];
  status: "extracted" | "confirmed";
  resume_quality_score?: number | null;
  resume_quality_notes?: string | null;
  ats_match_score?: number | null;
  ats_match_notes?: string | null;
  skill_relevance_notes?: string | null;
  feedback_acknowledged?: boolean;
  ai_improved_resume?: string | null;
  improved_ats_score?: number | null;
  improved_quality_score?: number | null;
  improve_next_steps?: string[] | null;
  improve_motivation?: string | null;
  improved_at?: string | null;
}

interface AssessmentQuestion {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
}

type ScoreTier = "bad" | "good" | "excellent";

/**
 * The gate, from §9 of the architecture: below this the student is offered the
 * rebuild and cannot continue past it.
 *
 * It read 65 and gated nothing — a red badge and an open door. A student at 41%
 * could walk straight into the assessment, which is the one place the platform
 * is supposed to insist.
 */
const ATS_GATE = 60;

const getTier = (ats: number | null | undefined): ScoreTier => {
  if (ats == null || ats < ATS_GATE) return "bad";
  if (ats <= 85) return "good";
  return "excellent";
};

// Must stay in sync with resume-parser's own size/type checks.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"];

// Points a reload back at the in-progress assessment so the modal can
// reopen with the same assessment_id/questions — the assessment's own
// question/answer progress is then restored by TimedResumeAssessment itself.
const activeAssessmentKey = (claimId: string) => `resume-assessment-active-${claimId}`;

const saveActiveAssessment = (claimId: string, assessmentId: string, questions: AssessmentQuestion[]) => {
  try {
    localStorage.setItem(activeAssessmentKey(claimId), JSON.stringify({ assessmentId, questions }));
  } catch {
    // storage full/unavailable — reload-resume just won't work, not fatal
  }
};

const clearActiveAssessment = (claimId: string) => {
  try {
    localStorage.removeItem(activeAssessmentKey(claimId));
  } catch {
    // ignore
  }
};

interface ResumeCheckFlowProps {
  onGraded?: (result: ResumeScoreResult) => void;
  onNavigateTab?: (tab: string) => void;
}

// Single section visible at a time — no stacked cards to scroll through.
type Step = "upload" | "feedback" | "review" | "prove" | "results";

const ResumeCheckFlow = ({ onGraded, onNavigateTab }: ResumeCheckFlowProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loadingExisting, setLoadingExisting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claim, setClaim] = useState<ResumeClaimRow | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);

  const [targetRole, setTargetRole] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectClaim[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [newCert, setNewCert] = useState("");

  const [improving, setImproving] = useState(false);
  const [improvedResume, setImprovedResume] = useState<string | null>(null);

  const [generatingAssessment, setGeneratingAssessment] = useState(false);
  const [retesting, setRetesting] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [scoreResult, setScoreResult] = useState<ResumeScoreResult | null>(null);

  const [lastGradedAt, setLastGradedAt] = useState<Date | null>(null);

  const tier = getTier(claim?.ats_match_score);
  // One Auto-fix per upload, only under 60%. After it, everyone may take the
  // assessment - with clear next steps if the score is still under 60.
  const fixed = Boolean(claim?.improved_at);
  const blocked = tier === "bad" && !fixed;
  const retestUnlockAt = lastGradedAt ? addDays(lastGradedAt, RETEST_COOLDOWN_DAYS) : null;
  const retestLocked = !!retestUnlockAt && retestUnlockAt.getTime() > Date.now();

  const loadLatestClaim = useCallback(async () => {
    if (!user) return;
    const { data: profile } = await supabase
      .from("student_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!profile) {
      setLoadingExisting(false);
      return;
    }

    const { data, error } = await supabase
      .from("resume_claims")
      .select(
        "id, target_role, skills, certifications, projects, status, resume_quality_score, resume_quality_notes, ats_match_score, ats_match_notes, skill_relevance_notes, feedback_acknowledged, ai_improved_resume, improved_ats_score, improved_quality_score, improve_next_steps, improve_motivation, improved_at"
      )
      .eq("student_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error loading resume claims:", error);
    } else if (data) {
      const row = data as unknown as ResumeClaimRow;
      setClaim(row);
      setTargetRole(row.target_role || "");
      setSkills(row.skills || []);
      setCertifications(row.certifications || []);
      setProjects((row.projects as ProjectClaim[]) || []);
      setImprovedResume(row.ai_improved_resume || null);

      if (row.status === "confirmed") {
        const { data: scorecard } = await supabase
          .from("resume_scorecards")
          .select("resume_quality_score, ats_match_score, skill_proof_score, roadmap, skill_gap, voice_authenticity_score, voice_notes, coding_score, project_proof_score, reasoning_score, interview_readiness_score, created_at")
          .eq("resume_claims_id", row.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (scorecard) {
          setScoreResult({
            resume_quality_score: scorecard.resume_quality_score,
            ats_match_score: scorecard.ats_match_score,
            skill_proof_score: scorecard.skill_proof_score ?? 0,
            roadmap: scorecard.roadmap || "",
            skill_gap: scorecard.skill_gap as ResumeScoreResult["skill_gap"],
            voice_authenticity_score: scorecard.voice_authenticity_score,
            voice_notes: scorecard.voice_notes,
            coding_score: scorecard.coding_score,
            project_proof_score: scorecard.project_proof_score,
            reasoning_score: scorecard.reasoning_score,
            interview_readiness_score: scorecard.interview_readiness_score,
          });
          setLastGradedAt(new Date(scorecard.created_at));
        }
      }
    }
    setLoadingExisting(false);
  }, [user]);

  useEffect(() => {
    loadLatestClaim();
  }, [loadLatestClaim]);

  // Reopen an in-progress assessment after a page reload once the claim it
  // belongs to has loaded.
  useEffect(() => {
    if (!claim || assessmentId) return;
    try {
      const raw = localStorage.getItem(activeAssessmentKey(claim.id));
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.assessmentId && saved?.questions) {
          setAssessmentId(saved.assessmentId);
          setAssessmentQuestions(saved.questions);
          setModalOpen(true);
        }
      }
    } catch {
      // corrupt/old pointer — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim?.id]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;

    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      toast({ title: "PDF or DOCX only", description: "Please upload your resume as a PDF or DOCX file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "File too large", description: "Resume must be under 5MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const storagePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;

      // Text is extracted in the browser (OCR if it is a scan) so a text-only
      // model can read the PDF.
      let resumeTextValue: string | undefined;
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const { extractPdfText } = await import("@/lib/pdfText");
        const extracted = await extractPdfText(file);
        resumeTextValue = extracted.text;
      }

      const { data, error: parseError } = await supabase.functions.invoke("resume-parser", {
        body: { storage_path: storagePath, resume_text: resumeTextValue },
      });
      if (parseError) throw parseError;
      if (data?.error) throw new Error(data.error);

      setTargetRole(data.target_role || "");
      setSkills(data.skills || []);
      setCertifications(data.certifications || []);
      setProjects(data.projects || []);
      setImprovedResume(null);
      setScoreResult(null);
      setEditingDetails(false);
      setClaim({
        id: data.resume_claim_id,
        target_role: data.target_role,
        skills: data.skills,
        certifications: data.certifications,
        projects: data.projects,
        status: "extracted",
        resume_quality_score: data.resume_quality_score,
        resume_quality_notes: data.resume_quality_notes,
        ats_match_score: data.ats_match_score,
        ats_match_notes: data.ats_match_notes,
        skill_relevance_notes: data.skill_relevance_notes,
        feedback_acknowledged: false,
        ai_improved_resume: null,
      });

      toast({
        title: "Resume analyzed",
        description: "Here's how it scores — check the feedback below.",
      });
    } catch (err: any) {
      console.error("Resume upload/parse failed:", err);
      toast({
        title: "Couldn't process resume",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const addSkill = () => {
    const v = newSkill.trim();
    if (v && !skills.includes(v)) setSkills([...skills, v]);
    setNewSkill("");
  };
  const addCert = () => {
    const v = newCert.trim();
    if (v && !certifications.includes(v)) setCertifications([...certifications, v]);
    setNewCert("");
  };
  const updateProject = (index: number, patch: Partial<ProjectClaim>) => {
    setProjects(projects.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };
  const removeProject = (index: number) => {
    setProjects(projects.filter((_, i) => i !== index));
  };
  const addProject = () => {
    setProjects([...projects, { name: "", description: "", tech_stack: [] }]);
  };

  const handleConfirm = async () => {
    if (!claim) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("resume_claims")
        .update({
          target_role: targetRole || null,
          skills,
          certifications,
          // ProjectClaim is a fixed shape; the column is jsonb, which the
          // generated types describe as an open-ended Json. The cast says
          // "this really is JSON-serialisable" — it is, it goes over the wire.
          projects: projects as unknown as Json,
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", claim.id);
      if (error) throw error;

      setClaim({ ...claim, status: "confirmed", target_role: targetRole, skills, certifications, projects });
      setEditingDetails(false);
      toast({ title: "Confirmed", description: "Your resume claims are locked in." });
    } catch (err: any) {
      console.error("Error confirming resume claims:", err);
      toast({ title: "Couldn't save", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleImprove = async () => {
    if (!claim) return;
    setImproving(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-improve", {
        body: { resume_claims_id: claim.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setImprovedResume(data.improved_resume);
      setClaim((c) => c ? {
        ...c,
        ai_improved_resume: data.improved_resume,
        improved_ats_score: data.after_ats,
        improved_quality_score: data.after_quality,
        improve_next_steps: data.next_steps,
        improve_motivation: data.motivation,
        improved_at: new Date().toISOString(),
      } : c);
    } catch (err: any) {
      console.error("Error improving resume:", err);
      toast({ title: "Couldn't generate a fix", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setImproving(false);
    }
  };

  const handleDownloadImproved = () => {
    if (!improvedResume) return;
    downloadResumeAsPdf(improvedResume, "improved-resume.pdf");
  };

  const handleStartAssessment = async () => {
    if (!claim) return;
    setGeneratingAssessment(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-question-generator", {
        body: { resume_claims_id: claim.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAssessmentId(data.assessment_id);
      setAssessmentQuestions(data.questions || []);
      setModalOpen(true);
      saveActiveAssessment(claim.id, data.assessment_id, data.questions || []);
    } catch (err: any) {
      console.error("Error starting assessment:", err);
      toast({ title: "Couldn't start assessment", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setGeneratingAssessment(false);
    }
  };

  const handleRetestWeak = async () => {
    if (!claim) return;
    setRetesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-retest-generate", {
        body: { resume_claims_id: claim.id },
      });
      if (error) {
        // FunctionsHttpError only carries the raw Response — pull the real
        // message our function set (e.g. the cooldown text) out of its body.
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null);
          throw new Error(body?.error || error.message);
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);

      if (data.no_weak_topics) {
        toast({ title: "Nothing to retest", description: "You scored solid across the board — no weak topics found." });
        return;
      }

      setAssessmentId(data.assessment_id);
      setAssessmentQuestions(data.questions || []);
      setModalOpen(true);
      saveActiveAssessment(claim.id, data.assessment_id, data.questions || []);
    } catch (err: any) {
      console.error("Error starting retest:", err);
      toast({ title: "Not ready yet", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setRetesting(false);
    }
  };

  const handleGraded = (result: ResumeScoreResult) => {
    setScoreResult(result);
    setLastGradedAt(new Date());
    onGraded?.(result);
    if (claim) clearActiveAssessment(claim.id);
  };

  if (loadingExisting) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resume Check</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-24 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // The feedback and review screens were two separate steps, so a student who
  // had just uploaded their resume clicked through two "yes" screens before
  // anything happened. They are now one screen: the scores sit above the skill
  // list, and Confirm & continue is the single action. The "feedback" step
  // still exists in the type, but nothing selects it any more.
  const step: Step = !claim
    ? "upload"
    : editingDetails || claim.status !== "confirmed"
    ? "review"
    : !scoreResult
    ? "prove"
    : "results";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <FileCheck2 className="h-5 w-5" />
            Resume Check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "upload" && (
            <p className="text-sm text-muted-foreground">
              Upload your resume. We'll pull out the skills, certifications, projects, and target role you've written —
              you confirm or fix anything before it's used to test you.
            </p>
          )}

          <div>
            <input
              type="file"
              accept=".pdf,.docx"
              id="resume-file-input"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {/* Only on the upload step. It used to render on every screen, so
                the page you landed on straight after uploading greeted you with
                an upload button — it read as "do it again". Replacing a resume
                is now a small link at the bottom of the review screen. */}
            {(step === "upload" || uploading) && (
              <label htmlFor="resume-file-input">
                <Button asChild disabled={uploading}>
                  <span>
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing resume...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" /> Upload resume (PDF)
                      </>
                    )}
                  </span>
                </Button>
              </label>
            )}
          </div>

          {claim?.status === "confirmed" && step !== "upload" && (
            <Alert className="border-green-300 bg-green-50 dark:bg-green-950/30 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-300 text-sm">
                Confirmed. This is what your assessment is based on.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {step === "review" && claim && tier !== "excellent" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Resume feedback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border rounded-lg p-3">
                <div className="text-2xl font-bold">{claim.resume_quality_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1 mb-2">Resume Quality</div>
                <p className="text-sm text-muted-foreground">{claim.resume_quality_notes}</p>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-2xl font-bold">{claim.ats_match_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1 mb-2">ATS Match</div>
                <p className="text-sm text-muted-foreground">{claim.ats_match_notes}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {tier === "bad"
                ? fixed
                  ? `The one-time AI fix is done. Use the steps below to improve it further.`
                  : `Below ${ATS_GATE}% ATS match — use the one-time Auto-fix, or edit and re-upload.`
                : `${ATS_GATE}-85% ATS match — solid. The notes above say what would make it stronger.`}
            </p>

            {fixed && claim && (
              <div className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm font-medium">AI-improved resume</p>
                  <span className="font-mono text-sm">
                    ATS {claim.ats_match_score ?? 0}% → <b className={(claim.improved_ats_score ?? 0) >= ATS_GATE ? "text-emerald-600" : "text-amber-600"}>{claim.improved_ats_score ?? 0}%</b>
                  </span>
                  <Button type="button" size="sm" className="ml-auto" onClick={handleDownloadImproved} disabled={!improvedResume}>
                    <Download className="h-4 w-4 mr-1" /> Download improved resume (PDF)
                  </Button>
                </div>
                {improvedResume && (
                  <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto rounded bg-muted/40 p-2">{improvedResume}</pre>
                )}
                {(claim.improved_ats_score ?? 0) < ATS_GATE && (claim.improve_next_steps?.length ?? 0) > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <p className="text-sm font-medium">To raise it further, add these yourself:</p>
                    <ol className="mt-1 list-decimal pl-5 text-sm space-y-1">
                      {claim.improve_next_steps!.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                  </div>
                )}
                {claim.improve_motivation && (
                  <p className="text-sm">💪 {claim.improve_motivation}</p>
                )}
                <p className="text-xs text-muted-foreground">You can take the assessment now, below.</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {/* Auto-fix: only under 60%, and only once per upload. */}
              {tier === "bad" && !fixed && (
                <Button type="button" onClick={handleImprove} disabled={improving}>
                  {improving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fixing and re-checking…</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" /> Auto-fix with AI (one time)</>
                  )}
                </Button>
              )}
              <label htmlFor="resume-file-input">
                <Button asChild type="button" variant="outline">
                  <span>Edit myself &amp; re-upload</span>
                </Button>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && claim && tier === "excellent" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              Excellent resume
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{claim.resume_quality_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Resume Quality</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{claim.ats_match_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">ATS Match</div>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Are your skills actually valuable?</p>
              <p className="text-sm text-muted-foreground">{claim.skill_relevance_notes}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && claim && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {claim.status === "confirmed" ? "Edit confirmed details" : "Review what we found"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-1 block">Target role</label>
              <Select
                value={TARGET_ROLES.includes(targetRole) ? targetRole : targetRole ? "Other" : ""}
                onValueChange={(v) => setTargetRole(v === "Other" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select your target role" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(!TARGET_ROLES.includes(targetRole) || targetRole === "") && (
                <Input
                  className="mt-2"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  placeholder="Type your role, e.g. Embedded Systems Engineer"
                />
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Skills</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {skills.map((s, i) => (
                  <Badge key={`${s}-${i}`} variant="secondary" className="flex items-center gap-1">
                    {s}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setSkills(skills.filter((_, j) => j !== i))} />
                  </Badge>
                ))}
                {skills.length === 0 && <span className="text-sm text-muted-foreground">None found</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
                  placeholder="Add a skill"
                  className="max-w-xs"
                />
                <Button type="button" size="sm" variant="outline" onClick={addSkill}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Certifications</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {certifications.map((c, i) => (
                  <Badge key={`${c}-${i}`} variant="secondary" className="flex items-center gap-1">
                    {c}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setCertifications(certifications.filter((_, j) => j !== i))}
                    />
                  </Badge>
                ))}
                {certifications.length === 0 && <span className="text-sm text-muted-foreground">None found</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCert}
                  onChange={(e) => setNewCert(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCert())}
                  placeholder="Add a certification"
                  className="max-w-xs"
                />
                <Button type="button" size="sm" variant="outline" onClick={addCert}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Projects</label>
              <div className="space-y-3">
                {projects.map((p, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2 relative">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute top-2 right-2 h-6 w-6"
                      onClick={() => removeProject(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Input
                      value={p.name}
                      onChange={(e) => updateProject(i, { name: e.target.value })}
                      placeholder="Project name"
                      className="font-medium"
                    />
                    <Textarea
                      value={p.description}
                      onChange={(e) => updateProject(i, { description: e.target.value })}
                      placeholder="What does it do?"
                      rows={2}
                    />
                    <Input
                      value={(p.tech_stack || []).join(", ")}
                      onChange={(e) =>
                        updateProject(i, { tech_stack: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
                      }
                      placeholder="Tech stack, comma separated"
                    />
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={addProject}>
                <Plus className="h-4 w-4 mr-1" /> Add project
              </Button>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                  </>
                ) : claim.status === "confirmed" ? (
                  "Save changes"
                ) : (
                  "Confirm & continue"
                )}
              </Button>
              {claim.status === "confirmed" && (
                <Button variant="ghost" onClick={() => setEditingDetails(false)} disabled={saving}>
                  Cancel
                </Button>
              )}
            </div>

            {/* Replacing the resume stays possible, just quietly. */}
            <label htmlFor="resume-file-input" className="block">
              <span className="text-xs text-muted-foreground underline cursor-pointer hover:text-foreground">
                Wrong resume? Upload a different one
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {step === "prove" && claim && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Prove it
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A handful of quick questions based only on what's above — 30 seconds for each choice question, 90 for each written one, no going back.
            </p>

            {/* The gate. A resume this weak is not worth testing against: the
                questions come from what it claims, so a thin resume produces a
                thin assessment and a score that means nothing. */}
            {blocked && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-sm font-medium">Rebuild your resume first</p>
                <p className="text-sm text-muted-foreground mt-1">
                  It scores {claim.ats_match_score ?? 0}% against your target role, under the{" "}
                  {ATS_GATE}% the assessment needs. The rebuild rewrites how your existing work
                  reads — it never invents anything — and then re-scores it.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleStartAssessment}
                disabled={generatingAssessment || blocked}
              >
                {generatingAssessment ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building your questions...
                  </>
                ) : (
                  "Start assessment"
                )}
              </Button>
              <Button variant="outline" onClick={() => setEditingDetails(true)}>
                <Pencil className="h-4 w-4 mr-2" /> Edit details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "results" && claim && scoreResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Your results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.resume_quality_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Resume Quality</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.ats_match_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">ATS Match</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.skill_proof_score}</div>
                <div className="text-xs text-muted-foreground mt-1">Skill Proof</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.project_proof_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Project Proof</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.reasoning_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Reasoning</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{scoreResult.interview_readiness_score ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Interview Readiness</div>
              </div>
            </div>
            {scoreResult.voice_authenticity_score != null && (
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">Voice authenticity</p>
                  <span className="text-lg font-bold">{scoreResult.voice_authenticity_score}</span>
                </div>
                <p className="text-sm text-muted-foreground">{scoreResult.voice_notes}</p>
              </div>
            )}
            {scoreResult.coding_score != null && (
              <div className="border rounded-lg p-3 flex items-center justify-between">
                <p className="text-sm font-medium">Coding round</p>
                <span className="text-lg font-bold">{scoreResult.coding_score}</span>
              </div>
            )}
            {scoreResult.skill_gap && (
              <div className="border rounded-lg p-3">
                <p className="text-sm font-medium mb-2">Skill gap for {targetRole || "your target role"}</p>
                <SkillGap skillGap={scoreResult.skill_gap} />
              </div>
            )}
            <div>
              <p className="text-sm font-medium mb-1">Your roadmap</p>
              <RoadmapStages roadmap={scoreResult.roadmap} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleRetestWeak}
                disabled={retesting || generatingAssessment || retestLocked}
                title={retestLocked && retestUnlockAt ? `Unlocks ${formatDistanceToNow(retestUnlockAt, { addSuffix: true })}` : undefined}
              >
                {retesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building retest...
                  </>
                ) : retestLocked && retestUnlockAt ? (
                  `Retest unlocks ${formatDistanceToNow(retestUnlockAt, { addSuffix: true })}`
                ) : (
                  "Retest weak topics"
                )}
              </Button>
              <Button variant="outline" onClick={handleStartAssessment} disabled={generatingAssessment || retesting}>
                {generatingAssessment ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building your questions...
                  </>
                ) : (
                  "Retake full assessment"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setEditingDetails(true)}>
                <Pencil className="h-4 w-4 mr-2" /> Edit details
              </Button>
            </div>
            {retestLocked && (
              <p className="text-xs text-muted-foreground">
                Use this time to work through your roadmap — instant retesting doesn't build real understanding.
              </p>
            )}

            {onNavigateTab && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => onNavigateTab("resume-jobmatch")}>Match to a Job</Button>
                <Button variant="outline" size="sm" onClick={() => onNavigateTab("resume-certs")}>Certification Radar</Button>
                <Button variant="outline" size="sm" onClick={() => onNavigateTab("resume-history")}>Retest History</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {assessmentId && claim && (
        <TimedResumeAssessment
          open={modalOpen}
          onOpenChange={setModalOpen}
          assessmentId={assessmentId}
          source={{ resume_claims_id: claim.id }}
          questions={assessmentQuestions}
          onGraded={handleGraded}
        />
      )}
    </div>
  );
};

export default ResumeCheckFlow;
