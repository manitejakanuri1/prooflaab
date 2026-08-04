import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, SkipForward, CheckCircle2 } from "lucide-react";
import type { TaskSource } from "@/hooks/useStudentIntake";

/** Spec: PDF or DOCX, under 5 MB. Kept in sync with resume-parser's own check. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"];

interface IntakeChoiceProps {
  onDone: (source: TaskSource) => Promise<void> | void;
}

/**
 * 2.2 — how we decide what to send you.
 *
 * Button 1 reads the resume purely to extract claimed skills. It deliberately
 * does NOT call resume-improve, so nothing is scored at this stage.
 */
const IntakeChoice = ({ onDone }: IntakeChoiceProps) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [extracted, setExtracted] = useState<string[] | null>(null);

  const busy = uploading || skipping;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      toast({
        title: "PDF or DOCX only",
        description: "Upload your resume as a PDF or DOCX file.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "File too large",
        description: "Your resume must be under 5 MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const storagePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;

      // Extraction only — no scoring at this stage.
      const { data, error: parseError } = await supabase.functions.invoke("resume-parser", {
        body: { storage_path: storagePath },
      });
      if (parseError) throw parseError;
      if (data?.error) throw new Error(data.error);

      const skills: string[] = data?.skills ?? [];
      setExtracted(skills);

      await onDone("resume");
    } catch (err) {
      toast({
        title: "Could not read your resume",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      await onDone("general");
    } catch (err) {
      toast({
        title: "Something went wrong",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setSkipping(false);
    }
  };

  if (extracted) {
    return (
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-4">
          <CheckCircle2 className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Got it.</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          {extracted.length > 0
            ? "These are the skills you claimed. We will pull your tasks from these."
            : "We could not find clear skill claims, so we will start you on general tasks."}
        </p>
        {extracted.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {extracted.map((skill, i) => (
              <Badge key={`${skill}-${i}`} variant="secondary">{skill}</Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Taking you in…
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
        What should we send you?
      </h2>
      <p className="text-muted-foreground mb-8">
        Pick one. You can change this later.
      </p>

      <div className="space-y-4">
        {/* Button 1 */}
        <div className="border rounded-lg p-5">
          <input
            type="file"
            accept=".pdf,.docx"
            id="intake-resume-input"
            className="hidden"
            onChange={handleFileChange}
            disabled={busy}
          />
          <label htmlFor="intake-resume-input">
            <Button asChild size="lg" className="w-full justify-start" disabled={busy}>
              <span>
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reading your resume…
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload your resume
                  </>
                )}
              </span>
            </Button>
          </label>
          <p className="text-sm text-muted-foreground mt-3">
            We read it to find which skills you have claimed. We are not scoring it yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">PDF or DOCX. Under 5 MB.</p>
        </div>

        {/* Button 2 */}
        <div className="border rounded-lg p-5">
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-start"
            onClick={handleSkip}
            disabled={busy}
          >
            {skipping ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting you up…
              </>
            ) : (
              <>
                <SkipForward className="mr-2 h-4 w-4" />
                Skip &mdash; send me a general task
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default IntakeChoice;
