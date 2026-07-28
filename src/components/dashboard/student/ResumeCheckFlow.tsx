import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileCheck2, Upload, X, Plus, CheckCircle2, Loader2, ClipboardList, Sparkles, Download, ArrowRight, Award, Briefcase, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import TimedResumeAssessment, { ResumeScoreResult } from "./TimedResumeAssessment";
import { downloadResumeAsPdf } from "@/lib/resumePdf";

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
}

interface AssessmentQuestion {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
}

interface JdMatchResult {
  jd_title: string | null;
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  suggestions: string;
}

interface HistoryEntry {
  id: string;
  created_at: string;
  resume_quality_score: number | null;
  ats_match_score: number | null;
  skill_proof_score: number | null;
  voice_authenticity_score: number | null;
  coding_score: number | null;
}

type ScoreTier = "bad" | "good" | "excellent";

const getTier = (ats: number | null | undefined): ScoreTier => {
  if (ats == null || ats < 65) return "bad";
  if (ats <= 85) return "good";
  return "excellent";
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface ResumeCheckFlowProps {
  onGraded?: (result: ResumeScoreResult) => void;
}

const ResumeCheckFlow = ({ onGraded }: ResumeCheckFlowProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loadingExisting, setLoadingExisting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claim, setClaim] = useState<ResumeClaimRow | null>(null);

  const [targetRole, setTargetRole] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectClaim[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [newCert, setNewCert] = useState("");

  const [improving, setImproving] = useState(false);
  const [improvedResume, setImprovedResume] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  const [generatingAssessment, setGeneratingAssessment] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [scoreResult, setScoreResult] = useState<ResumeScoreResult | null>(null);

  const [jdText, setJdText] = useState("");
  const [matchingJd, setMatchingJd] = useState(false);
  const [jdResult, setJdResult] = useState<JdMatchResult | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const tier = getTier(claim?.ats_match_score);

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
        "id, target_role, skills, certifications, projects, status, resume_quality_score, resume_quality_notes, ats_match_score, ats_match_notes, skill_relevance_notes, feedback_acknowledged, ai_improved_resume"
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
          .select("resume_quality_score, ats_match_score, skill_proof_score, roadmap, voice_authenticity_score, voice_notes, coding_score")
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
            voice_authenticity_score: scorecard.voice_authenticity_score,
            voice_notes: scorecard.voice_notes,
            coding_score: scorecard.coding_score,
          });
        }
      }
    }
    setLoadingExisting(false);
  }, [user]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data: profile } = await supabase
      .from("student_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!profile) {
      setLoadingHistory(false);
      return;
    }

    const { data, error } = await supabase
      .from("resume_scorecards")
      .select("id, created_at, resume_quality_score, ats_match_score, skill_proof_score, voice_authenticity_score, coding_score")
      .eq("student_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error loading resume history:", error);
    } else {
      setHistory((data as HistoryEntry[]) || []);
    }
    setLoadingHistory(false);
  }, [user]);

  useEffect(() => {
    loadLatestClaim();
    loadHistory();
  }, [loadLatestClaim, loadHistory]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "PDF only", description: "Please upload your resume as a PDF file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "File too large", description: "Resume must be under 8MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const storagePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data, error: parseError } = await supabase.functions.invoke("resume-parser", {
        body: { storage_path: storagePath },
      });
      if (parseError) throw parseError;
      if (data?.error) throw new Error(data.error);

      setTargetRole(data.target_role || "");
      setSkills(data.skills || []);
      setCertifications(data.certifications || []);
      setProjects(data.projects || []);
      setImprovedResume(null);
      setScoreResult(null);
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
          projects,
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", claim.id);
      if (error) throw error;

      setClaim({ ...claim, status: "confirmed", target_role: targetRole, skills, certifications, projects });
      toast({ title: "Confirmed", description: "Your resume claims are locked in. Assessment questions are next." });
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

  const handleAcknowledge = async () => {
    if (!claim) return;
    setAcknowledging(true);
    try {
      const { error } = await supabase
        .from("resume_claims")
        .update({ feedback_acknowledged: true })
        .eq("id", claim.id);
      if (error) throw error;
      setClaim({ ...claim, feedback_acknowledged: true });
    } catch (err: any) {
      console.error("Error acknowledging feedback:", err);
      toast({ title: "Couldn't continue", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setAcknowledging(false);
    }
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
    } catch (err: any) {
      console.error("Error starting assessment:", err);
      toast({ title: "Couldn't start assessment", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setGeneratingAssessment(false);
    }
  };

  const handleGraded = (result: ResumeScoreResult) => {
    setScoreResult(result);
    onGraded?.(result);
    loadHistory();
  };

  const handleMatchJd = async () => {
    if (!claim || !jdText.trim()) return;
    setMatchingJd(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-jd-match", {
        body: { resume_claims_id: claim.id, jd_text: jdText },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setJdResult({
        jd_title: data.jd_title,
        match_score: data.match_score,
        matched_skills: data.matched_skills || [],
        missing_skills: data.missing_skills || [],
        suggestions: data.suggestions || "",
      });
    } catch (err: any) {
      console.error("JD match failed:", err);
      toast({ title: "Couldn't check match", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setMatchingJd(false);
    }
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
          <p className="text-sm text-muted-foreground">
            Upload your resume. We'll pull out the skills, certifications, projects, and target role you've written —
            you confirm or fix anything before it's used to test you.
          </p>

          <div>
            <input
              type="file"
              accept=".pdf"
              id="resume-file-input"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <label htmlFor="resume-file-input">
              <Button asChild variant="default" disabled={uploading}>
                <span>
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing resume...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" /> {claim ? "Upload a new resume" : "Upload resume (PDF)"}
                    </>
                  )}
                </span>
              </Button>
            </label>
          </div>

          {claim?.status === "confirmed" && (
            <Alert className="border-green-300 bg-green-50 dark:bg-green-950/30">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-300">
                Confirmed. This is what your assessment will be based on.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {claim && !claim.feedback_acknowledged && claim.status !== "confirmed" && tier !== "excellent" && (
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
              {tier === "bad" ? "Below 65% ATS match — worth fixing before you continue." : "65-85% ATS match — solid, but there's room to improve."}
            </p>

            {improvedResume && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">AI-improved resume</p>
                  <Button type="button" size="sm" variant="outline" onClick={handleDownloadImproved}>
                    <Download className="h-4 w-4 mr-1" /> Download PDF
                  </Button>
                </div>
                <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">{improvedResume}</pre>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleImprove} disabled={improving}>
                {improving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fixing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" /> {improvedResume ? "Regenerate with AI" : "Auto-fix with AI"}
                  </>
                )}
              </Button>
              <label htmlFor="resume-file-input">
                <Button asChild type="button" variant="outline">
                  <span>Edit myself &amp; re-upload</span>
                </Button>
              </label>
              <Button type="button" onClick={handleAcknowledge} disabled={acknowledging} className="ml-auto">
                {acknowledging ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Continuing...
                  </>
                ) : (
                  <>
                    I'm satisfied, continue <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {claim && !claim.feedback_acknowledged && claim.status !== "confirmed" && tier === "excellent" && (
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
            <Button type="button" onClick={handleAcknowledge} disabled={acknowledging}>
              {acknowledging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Continuing...
                </>
              ) : (
                <>
                  Continue <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {claim && (claim.feedback_acknowledged || claim.status === "confirmed") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {claim.status === "confirmed" ? "Confirmed details" : "Review what we found"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-1 block">Target role</label>
              <Input
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                placeholder="e.g. Backend Developer"
              />
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

            <Button onClick={handleConfirm} disabled={saving} className="w-full sm:w-auto">
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
          </CardContent>
        </Card>
      )}

      {claim?.status === "confirmed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Prove it
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!scoreResult ? (
              <>
                <p className="text-sm text-muted-foreground">
                  10 quick questions based only on what's above — 15 seconds each, no going back.
                </p>
                <Button onClick={handleStartAssessment} disabled={generatingAssessment}>
                  {generatingAssessment ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building your questions...
                    </>
                  ) : (
                    "Start assessment"
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <div>
                  <p className="text-sm font-medium mb-1">Your roadmap</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{scoreResult.roadmap}</p>
                </div>
                <Button variant="outline" onClick={handleStartAssessment} disabled={generatingAssessment}>
                  {generatingAssessment ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building your questions...
                    </>
                  ) : (
                    "Retake assessment"
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {claim?.status === "confirmed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Match to a job
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste a real job description to see how your confirmed resume actually matches it — not just a generic ATS guess.
            </p>
            <Textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the job description here..."
              rows={6}
            />
            <Button onClick={handleMatchJd} disabled={matchingJd || !jdText.trim()}>
              {matchingJd ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking match...
                </>
              ) : (
                "Check match"
              )}
            </Button>

            {jdResult && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{jdResult.jd_title || "This role"}</p>
                  <span className="text-2xl font-bold">{jdResult.match_score}</span>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Matched</p>
                  <div className="flex flex-wrap gap-2">
                    {jdResult.matched_skills.length > 0 ? jdResult.matched_skills.map((s, i) => (
                      <Badge key={i} variant="secondary">{s}</Badge>
                    )) : <span className="text-sm text-muted-foreground">None found</span>}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Missing</p>
                  <div className="flex flex-wrap gap-2">
                    {jdResult.missing_skills.length > 0 ? jdResult.missing_skills.map((s, i) => (
                      <Badge key={i} variant="outline" className="border-destructive/40 text-destructive">{s}</Badge>
                    )) : <span className="text-sm text-muted-foreground">Nothing major</span>}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">What to do</p>
                  <p className="text-sm text-muted-foreground">{jdResult.suggestions}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!loadingHistory && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5" />
              Retest history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium">Quality</th>
                    <th className="py-2 px-3 font-medium">ATS</th>
                    <th className="py-2 px-3 font-medium">Skill Proof</th>
                    <th className="py-2 px-3 font-medium">Voice</th>
                    <th className="py-2 px-3 font-medium">Coding</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {new Date(h.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                      <td className="py-2 px-3">{h.resume_quality_score ?? "—"}</td>
                      <td className="py-2 px-3">{h.ats_match_score ?? "—"}</td>
                      <td className="py-2 px-3">{h.skill_proof_score ?? "—"}</td>
                      <td className="py-2 px-3">{h.voice_authenticity_score ?? "—"}</td>
                      <td className="py-2 px-3">{h.coding_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {assessmentId && claim && (
        <TimedResumeAssessment
          open={modalOpen}
          onOpenChange={setModalOpen}
          assessmentId={assessmentId}
          resumeClaimsId={claim.id}
          questions={assessmentQuestions}
          onGraded={handleGraded}
        />
      )}
    </div>
  );
};

export default ResumeCheckFlow;
