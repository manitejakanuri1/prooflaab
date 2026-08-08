import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Map, Flag, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseStages, type RoadmapStage } from "./RoadmapStages";
import LevelMap from "./LevelMap";
import ResumeCheckFlow from "./ResumeCheckFlow";
import StudentResumeHistoryPage from "./StudentResumeHistoryPage";

interface StageTask {
  roadmap_stage_index: number;
  status: "Pending" | "In Progress" | "Under Review" | "Completed";
}

const statusMeta: Record<StageTask["status"], { label: string; className: string; icon: typeof Clock }> = {
  Pending: { label: "Not started", className: "border-muted-foreground/30 text-muted-foreground", icon: Clock },
  "In Progress": { label: "In progress", className: "border-amber-400 text-amber-600", icon: PlayCircle },
  "Under Review": { label: "Under review", className: "border-blue-400 text-blue-600", icon: Clock },
  Completed: { label: "Done", className: "border-emerald-500 text-emerald-600", icon: CheckCircle2 },
};

const StudentRoadmapPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<RoadmapStage[] | null>(null);
  const [taskStatusByStage, setTaskStatusByStage] = useState<Record<number, StageTask["status"]>>({});
  const [hasScorecard, setHasScorecard] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).single();
      if (!profile) {
        setLoading(false);
        return;
      }
      const { data: scorecard } = await supabase
        .from("resume_scorecards")
        .select("id, roadmap")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!scorecard) {
        setLoading(false);
        return;
      }
      setHasScorecard(true);
      setStages(parseStages(scorecard.roadmap));

      const { data: tasks } = await supabase
        .from("tasks")
        .select("roadmap_stage_index, started_at, proof_uploads(status)")
        .eq("roadmap_scorecard_id", scorecard.id);

      const statusMap: Record<number, StageTask["status"]> = {};
      (tasks || []).forEach((t: any) => {
        const proofs = Array.isArray(t.proof_uploads) ? t.proof_uploads : [];
        let status: StageTask["status"] = "Pending";
        if (proofs.length > 0) {
          status = proofs[proofs.length - 1].status === "Verified" ? "Completed" : "Under Review";
        } else if (t.started_at) {
          status = "In Progress";
        }
        statusMap[t.roadmap_stage_index] = status;
      });
      setTaskStatusByStage(statusMap);
      setLoading(false);
    })();
  }, [user]);

  const hasTaskStages = stages && stages.length > 0 && Object.keys(taskStatusByStage).length > 0;
  const doneCount = Object.values(taskStatusByStage).filter((s) => s === "Completed").length;

  // Two different questions, so two sections rather than one replacing the other.
  // The level map answers "where am I and what's next" — an ordered path that
  // exists whether or not they have ever taken a test. The card below answers
  // "what did I just get wrong", which only the assessment can tell them. Losing
  // either one would be a step backwards.
  return (
    <Tabs defaultValue="roadmap" className="space-y-4">
      <TabsList>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        <TabsTrigger value="resume-check">Resume Check</TabsTrigger>
        <TabsTrigger value="history">Retest History</TabsTrigger>
      </TabsList>

      <TabsContent value="roadmap" className="space-y-6">
        <LevelMap />

        {loading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="animate-pulse h-24 bg-muted rounded" />
            </CardContent>
          </Card>
        ) : !hasScorecard ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Map className="h-4 w-4" />
                From your assessment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Take a Resume Check and the specific things you got wrong show up here, on top of the
                path above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <RoadmapFromAssessment
            stages={stages}
            hasTaskStages={!!hasTaskStages}
            doneCount={doneCount}
            taskStatusByStage={taskStatusByStage}
            onGoToTasks={() => navigate("/student/tasks/assigned")}
          />
        )}
      </TabsContent>

      <TabsContent value="resume-check">
        <ResumeCheckFlow />
      </TabsContent>

      <TabsContent value="history">
        <StudentResumeHistoryPage />
      </TabsContent>
    </Tabs>
  );
};

interface RoadmapFromAssessmentProps {
  stages: RoadmapStage[] | null;
  hasTaskStages: boolean;
  doneCount: number;
  taskStatusByStage: Record<number, StageTask["status"]>;
  onGoToTasks: () => void;
}

const RoadmapFromAssessment = ({
  stages,
  hasTaskStages,
  doneCount,
  taskStatusByStage,
  onGoToTasks,
}: RoadmapFromAssessmentProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Map className="h-4 w-4" />
          From your assessment
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {hasTaskStages
            ? `${doneCount} of ${stages!.length} stages done — the specific things your last test caught.`
            : "The specific things your last test caught."}
        </p>
      </CardHeader>
      <CardContent>
        {!stages ? (
          <p className="text-sm text-muted-foreground">No roadmap available for your latest attempt.</p>
        ) : !hasTaskStages ? (
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {stages.map((s) => `${s.title} — ${s.why}`).join("\n")}
          </p>
        ) : (
          <div className="space-y-4">
            {stages.map((stage, i) => {
              const status = taskStatusByStage[i] ?? "Pending";
              const meta = statusMeta[status];
              const StatusIcon = meta.icon;
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {i + 1}
                    </div>
                    {i < stages.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="pb-4 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold leading-snug">{stage.title}</p>
                      <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                        <StatusIcon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{stage.why}</p>
                    <p className="text-sm mt-1 flex items-start gap-1.5">
                      <Flag className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                      <span>{stage.action}</span>
                    </p>
                    {status !== "Completed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={onGoToTasks}
                      >
                        {status === "Pending" ? "Start this stage" : "Continue in Assigned Tasks"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentRoadmapPage;
