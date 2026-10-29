import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, Mic } from "lucide-react";
import VoiceExplainModal from "./VoiceExplainModal";
import { loadLotState, SKIP_WARNING, voiceLine, type LotState } from "@/lib/lotMarks";

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
 *
 * A Daily Lot (migration 165): one good recording is the voice mark; a bad one (silent, too short,
 * about something else) can be recorded once more; two bad ones close the spoken part. The state is
 * read from the server while the recorder is open, because scoring finishes after the upload.
 */
export default function TaskVoicePanel({ unlocked, studentId, taskId, title, onSaved, onDone }: TaskVoicePanelProps) {
  const [lot, setLot] = useState<LotState | null>(null);
  const refresh = useCallback(() => { void loadLotState(taskId).then(setLot); }, [taskId]);

  useEffect(() => {
    if (!unlocked) return;
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [unlocked, refresh]);

  if (!unlocked) {
    return (
      <div className="space-y-3" data-testid="voice-locked">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-muted-foreground">
          <Mic className="h-5 w-5" /> Explain it — 60 seconds
        </h3>
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Submit your answer first. Then the recorder opens here and you explain your work in your own words.</p>
        </div>
      </div>
    );
  }

  const line = lot ? voiceLine(lot) : null;
  const finished = !!lot?.daily && (lot.voice_state === "scored" || !!lot.voice_closed);
  const note = (line || (lot?.daily && lot.skip_warning && !finished)) && (
    <div className="space-y-2" data-testid="lot-voice-note">
      {line && (
        <p className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${lot?.voice_state === "scored" ? "border-verified/50 text-verified" : "border-compete/50"}`}>
          {lot?.voice_state === "scored" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-compete" />}
          {line}
        </p>
      )}
      {lot?.daily && lot.skip_warning && !finished && (
        <p className="rounded-lg border-2 border-compete bg-compete/10 p-3 text-sm font-medium" data-testid="lot-skip-warning">
          {SKIP_WARNING}
        </p>
      )}
    </div>
  );

  // Closed after two bad recordings: nothing more to record for this Lot.
  if (lot?.daily && lot.voice_closed) {
    return (
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold"><Mic className="h-5 w-5" /> Explain it — 60 seconds</h3>
        {note}
        {onDone && (
          <button type="button" className="w-full rounded-md border px-3 py-2 text-sm" onClick={onDone}>
            Return to Dashboard
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {note}
      <VoiceExplainModal
        inline
        open
        onOpenChange={() => {}}
        studentId={studentId}
        taskId={taskId}
        prompt={`In your own words: how did you approach "${title}"?`}
        onSaved={() => { onSaved?.(); refresh(); }}
        onDone={onDone}
      />
    </div>
  );
}
