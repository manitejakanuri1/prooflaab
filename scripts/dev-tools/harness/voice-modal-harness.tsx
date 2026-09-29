// TEST-ONLY harness (Step 6): mounts the real VoiceExplainModal with props a
// test can change - open (as the parent), studentId (account change), taskId,
// proofId and mounted (unmount). Not imported by the app; see voice-modal-harness.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import VoiceExplainModal from "@/components/dashboard/student/VoiceExplainModal";

declare global {
  interface Window {
    __harness: {
      setOpen: (open: boolean) => void;
      setStudent: (id: string) => void;
      setTask: (id: string | null) => void;
      setProof: (id: string | null) => void;
      setMounted: (mounted: boolean) => void;
      onSavedCount: number;
    };
  }
}

const params = new URLSearchParams(location.search);
const FIRST_STUDENT = params.get("student") ?? "";
const TASK = params.has("task") ? params.get("task") : "harness-task";
const PROOF = params.get("proof");

function App() {
  const [open, setOpen] = useState(true);
  const [student, setStudent] = useState(FIRST_STUDENT);
  const [task, setTask] = useState<string | null>(TASK || null);
  const [proof, setProof] = useState<string | null>(PROOF || null);
  const [mounted, setMounted] = useState(true);
  window.__harness = window.__harness ?? { setOpen, setStudent, setTask, setProof, setMounted, onSavedCount: 0 };
  window.__harness.setOpen = setOpen;
  window.__harness.setStudent = setStudent;
  window.__harness.setTask = setTask;
  window.__harness.setProof = setProof;
  window.__harness.setMounted = setMounted;
  return (
    <div>
      <p data-testid="harness-state">open={String(open)} student={student} task={String(task)} proof={String(proof)} mounted={String(mounted)}</p>
      {mounted && (
        <VoiceExplainModal
          open={open}
          onOpenChange={setOpen}
          studentId={student}
          taskId={task}
          proofId={proof}
          prompt="Harness: explain your work."
          onSaved={() => { window.__harness.onSavedCount += 1; }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
