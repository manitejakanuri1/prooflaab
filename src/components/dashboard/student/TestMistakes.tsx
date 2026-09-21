import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

/** One thing the resume test caught, placed on the ladder by its skill. */
export interface TestMistake {
  skill: string;
  title: string;
  why: string;
  action: string;
  status: "Pending" | "In Progress" | "Under Review" | "Completed";
  /** The task behind this item, so Start can open exactly it. */
  taskId?: string;
}

/** Same rule the server uses to match skills: case, spaces, dots, dashes ignored. */
export const normSkill = (s: string) => s.toLowerCase().replace(/[\s._-]/g, "");

const STATUS_LABEL: Record<TestMistake["status"], string> = {
  Pending: "Not started",
  "In Progress": "In progress",
  "Under Review": "Under review",
  Completed: "Done",
};

/**
 * Mistakes shown as suggestions to revise. They never lock or unlock anything:
 * the ladder's order stays as it is, these just say what is worth going back to.
 */
const TestMistakes = ({ mistakes, onGoToTasks }: { mistakes: TestMistake[]; onGoToTasks?: (taskId?: string) => void }) => (
  <ul className="space-y-2">
    {mistakes.map((m, i) => (
      <li key={i} className="rounded-md border border-amber-400/40 bg-amber-500/5 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="h-5 gap-1 border-amber-400/60 text-amber-700 dark:text-amber-400">
            <RotateCcw className="h-3 w-3" /> Revise
          </Badge>
          <span className="text-sm font-medium">{m.title}</span>
          <span className="ml-auto text-xs text-muted-foreground">{STATUS_LABEL[m.status]} · 30 XP</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{m.why}</p>
        <p className="mt-0.5 text-xs">Next step: {m.action}</p>
        {m.status !== "Completed" && onGoToTasks && (
          <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => onGoToTasks(m.taskId)}>
            {m.status === "Pending" ? "Start" : "Continue"}
          </Button>
        )}
      </li>
    ))}
  </ul>
);

export default TestMistakes;
