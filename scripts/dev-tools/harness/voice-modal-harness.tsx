// TEST-ONLY harness (Step 6): mounts the real VoiceExplainModal with props a
// test can change - open (as the parent), studentId, taskId, proofId and
// mounted (unmount) - and the real in-page signed-in session (setAccount swaps
// the credentials AND the student, as a real account change does).
// Not imported by the app; see voice-modal-harness.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import VoiceExplainModal from "@/components/dashboard/student/VoiceExplainModal";
import { __setSessionForTests, type GoogleSession } from "@/integrations/google/identity";

declare global {
  interface Window {
    __harness: {
      setOpen: (open: boolean) => void;
      setStudent: (id: string) => void;
      setTask: (id: string | null) => void;
      setProof: (id: string | null) => void;
      setMounted: (mounted: boolean) => void;
      setAuth: (id: string | null) => void;
      setAccount: (id: string) => void;
      onSavedCount: number;
    };
    /** Sessions minted by the test, by student id (never real credentials). */
    __sessions?: Record<string, GoogleSession>;
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
  window.__harness = window.__harness ?? ({ onSavedCount: 0 } as Window["__harness"]);
  window.__harness.setOpen = setOpen;
  window.__harness.setStudent = setStudent;
  window.__harness.setTask = setTask;
  window.__harness.setProof = setProof;
  window.__harness.setMounted = setMounted;
  window.__harness.setAuth = (id) => __setSessionForTests(id ? window.__sessions?.[id] ?? null : null);
  window.__harness.setAccount = (id) => { window.__harness.setAuth(id); setStudent(id); };
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
