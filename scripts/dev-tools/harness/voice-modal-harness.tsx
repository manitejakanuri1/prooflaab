// TEST-ONLY harness (Step 6): mounts the real VoiceExplainModal with props a
// test can change - open (as the parent), studentId (account change) and
// mounted (unmount). Not imported by the app; see voice-modal-harness.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import VoiceExplainModal from "@/components/dashboard/student/VoiceExplainModal";

declare global {
  interface Window {
    __harness: {
      setOpen: (open: boolean) => void;
      setStudent: (id: string) => void;
      setMounted: (mounted: boolean) => void;
      onSavedCount: number;
    };
  }
}

const params = new URLSearchParams(location.search);
const FIRST_STUDENT = params.get("student") ?? "";
const TASK = params.get("task") ?? "harness-task";

function App() {
  const [open, setOpen] = useState(true);
  const [student, setStudent] = useState(FIRST_STUDENT);
  const [mounted, setMounted] = useState(true);
  window.__harness = window.__harness ?? { setOpen, setStudent, setMounted, onSavedCount: 0 };
  window.__harness.setOpen = setOpen;
  window.__harness.setStudent = setStudent;
  window.__harness.setMounted = setMounted;
  return (
    <div>
      <p data-testid="harness-state">open={String(open)} student={student} mounted={String(mounted)}</p>
      {mounted && (
        <VoiceExplainModal
          open={open}
          onOpenChange={setOpen}
          studentId={student}
          taskId={TASK}
          prompt="Harness: explain your work."
          onSaved={() => { window.__harness.onSavedCount += 1; }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
