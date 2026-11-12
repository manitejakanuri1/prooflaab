import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseStages, type RoadmapStage } from "./RoadmapStages";
import type { TestMistake } from "./TestMistakes";
import LevelMap from "./LevelMap";
import ThisWeekPlan from "./ThisWeekPlan";
import LoadFailed from "@/components/common/LoadFailed";

interface StageTask {
  roadmap_stage_index: number;
  status: "Pending" | "In Progress" | "Under Review" | "Completed";
}

const StudentRoadmapPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState<RoadmapStage[] | null>(null);
  const [taskStatusByStage, setTaskStatusByStage] = useState<Record<number, StageTask["status"]>>({});
  const [taskIdByStage, setTaskIdByStage] = useState<Record<number, string>>({});
  const [codingByStage, setCodingByStage] = useState<Record<number, boolean>>({});
  // S2/S9: a failed read (502) left the roadmap empty and "Start Task" without its task, so it went to the list
  // and looked like it did nothing. Now the failure is said, with Try again.
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setFailed(false);
      const { data: profile, error: pErr } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).single();
      if (pErr || !profile) { setFailed(true); return; }
      const { data: scorecard, error: sErr } = await supabase
        .from("resume_scorecards")
        .select("id, roadmap")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sErr) { setFailed(true); return; }
      if (!scorecard) return;
      setStages(parseStages(scorecard.roadmap));

      const { data: tasks, error: tErr } = await supabase
        .from("tasks")
        .select("id, roadmap_stage_index, started_at, status, sandbox_config_id, task_submissions(status, created_at)")
        .eq("roadmap_scorecard_id", scorecard.id);
      if (tErr) { setFailed(true); return; }

      const statusMap: Record<number, StageTask["status"]> = {};
      const idMap: Record<number, string> = {};
      const codingMap: Record<number, boolean> = {};
      (tasks || []).forEach((t: any) => {
        idMap[t.roadmap_stage_index] = t.id;
        codingMap[t.roadmap_stage_index] = Boolean(t.sandbox_config_id);
        // Graded attempts on this stage's task (task_submissions; proof uploads are retired).
        const attempts = Array.isArray(t.task_submissions) ? t.task_submissions : [];
        let status: StageTask["status"] = "Pending";
        if (t.status === "completed" || attempts.some((a: any) => a.status === "passed")) {
          status = "Completed";
        } else if (attempts.some((a: any) => a.status === "needs_review")) {
          status = "Under Review";
        } else if (t.started_at || attempts.length > 0) {
          status = "In Progress";
        }
        statusMap[t.roadmap_stage_index] = status;
      });
      setTaskStatusByStage(statusMap);
      setTaskIdByStage(idMap);
      setCodingByStage(codingMap);
    })();
  }, [user, reloadKey]);

  // The test's roadmap, shown on the ladder: each stage under the step whose
  // skill it names (anything unmatched goes in the "Other" box on the map).
  // "Clean sweep" is the no-mistakes placeholder, not something to revise.
  const mistakes: TestMistake[] = (stages ?? []).map((st, i) => ({
    skill: st.skill ?? "other",
    title: st.title,
    why: st.why,
    action: st.action,
    status: taskStatusByStage[i] ?? "Pending",
    taskId: taskIdByStage[i],
    coding: codingByStage[i],
  })).filter((m) => m.title !== "Clean sweep");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Your learning path: lessons and quizzes, step by step. Your one task for today is on the Daily Card.
      </p>
      <ThisWeekPlan />
      {failed && <LoadFailed what="your roadmap tasks" onRetry={() => setReloadKey((k) => k + 1)} />}
      <div id="ladder">
        <LevelMap mistakes={mistakes} onGoToTasks={(taskId) => navigate(taskId ? `/student/tasks/assigned?open=${taskId}` : "/student/tasks/assigned")} />
      </div>
    </div>
  );
};

export default StudentRoadmapPage;
