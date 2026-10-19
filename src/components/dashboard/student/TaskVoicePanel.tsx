import { Lock, Mic } from "lucide-react";
import VoiceExplainModal from "./VoiceExplainModal";

interface TaskVoicePanelProps {
  /** True once the answer has passed: the recorder opens in place. */
  unlocked: boolean;
  studentId: string;
  taskId: string;
  title: string;
  onSaved?: () => void;
  onDone?: () => void;
}

/**
 * The 60-second spoken explanation, beside the answer on the full-screen task
 * page. Locked until the answer passes: a recording needs a submission to belong
 * to (migration 61), so recording earlier would only be refused.
 */
export default function TaskVoicePanel({ unlocked, studentId, taskId, title, onSaved, onDone }: TaskVoicePanelProps) {
  if (!unlocked) {
    return (
      <div className="space-y-3" data-testid="voice-locked">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-muted-foreground">
          <Mic className="h-5 w-5" /> Explain it — 60 seconds
        </h3>
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Submit your answer first. When it passes, the recorder opens here and you explain your work in your own words.</p>
        </div>
      </div>
    );
  }
  return (
    <VoiceExplainModal
      inline
      open
      onOpenChange={() => {}}
      studentId={studentId}
      taskId={taskId}
      prompt={`In your own words: how did you approach "${title}"?`}
      onSaved={onSaved}
      onDone={onDone}
    />
  );
}
