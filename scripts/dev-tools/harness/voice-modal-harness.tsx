// TEST-ONLY harness (Step 6): mounts the real VoiceExplainModal with props a
// test can change - open (as the parent), studentId, taskId, proofId and
// mounted (unmount) - and the real signed-in account (setAccount signs in again through the web BFF
// AND switches the student, as a real account change does).
// Not imported by the app; see voice-modal-harness.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import VoiceExplainModal from "@/components/dashboard/student/VoiceExplainModal";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    __harness: {
      setOpen: (open: boolean) => void;
      setStudent: (id: string) => void;
      setTask: (id: string | null) => void;
      setProof: (id: string | null) => void;
      setMounted: (mounted: boolean) => void;
      setAuth: (id: string | null) => Promise<void>;
      setAccount: (id: string) => Promise<void>;
      onSavedCount: number;
    };
    /** Test logins by student id, given by the test for the page's own re-sign-in. Never shown or stored. */
    __logins?: Record<string, { email: string; password: string }>;
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
  // A REAL account change: the BFF replaces the HttpOnly session cookie and the page adopts the new
  // session, exactly as when another person signs in on this computer. Nothing is minted in the page.
  window.__harness.setAuth = async (id) => {
    if (!id) { await supabase.auth.signOut(); return; }
    const login = window.__logins?.[id];
    if (!login) throw new Error(`no test login for ${id}`);
    const { error } = await supabase.auth.signInWithPassword(login);
    if (error) throw error;
  };
  window.__harness.setAccount = async (id) => { await window.__harness.setAuth(id); setStudent(id); };
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
