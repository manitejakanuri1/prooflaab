import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, ArrowLeft } from "lucide-react";
import { format } from "date-fns";

interface StudentProofRecord {
  id: string;
  task_id: string;
  file_url: string | null;
  submission_notes: string | null;
  status: string | null;
  submitted_at: string | null;
}

const StudentProof = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proof, setProof] = useState<StudentProofRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "View Proof | ProofLabAI";
  }, []);

  useEffect(() => {
    const fetchProof = async () => {
      if (!id) {
        setError("Missing proof id in URL.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("proof_uploads")
          .select("id, task_id, file_url, submission_notes, status, submitted_at")
          .eq("id", id)
          .single();

        if (error) {
          console.error("Error fetching proof:", error);
          setError("Unable to load this proof. It may not exist or you may not have access.");
        } else {
          setProof(data as StudentProofRecord);
        }
      } catch (err) {
        console.error("Unexpected error fetching proof:", err);
        setError("Something went wrong while loading the proof.");
      } finally {
        setLoading(false);
      }
    };

    fetchProof();
  }, [id]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="max-w-3xl mx-auto px-4 py-8">
        <header className="flex items-center gap-4 mb-6">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">View Proof</h1>
            <p className="text-sm text-muted-foreground">
              Detailed view of your submitted proof and its current status.
            </p>
          </div>
        </header>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {!loading && error && (
          <Card>
            <CardHeader>
              <CardTitle>Unable to load proof</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-destructive mb-4">{error}</p>
              <Button variant="default" onClick={() => navigate(-1)}>
                Go back
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && !error && proof && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg">
                <span>Proof ID: {proof.id.slice(0, 8)}...</span>
                <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
                  Status: {proof.status ?? "Unknown"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {proof.submitted_at && (
                <div className="text-sm text-muted-foreground">
                  Submitted on {format(new Date(proof.submitted_at), "PPPp")} 
                </div>
              )}

              {proof.submission_notes && (
                <div>
                  <h2 className="text-sm font-medium mb-1">Submission notes</h2>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">
                    {proof.submission_notes}
                  </p>
                </div>
              )}

              {proof.file_url && (
                <div className="pt-2">
                  <Button asChild variant="outline">
                    <a
                      href={proof.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open proof file in a new tab"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open proof file
                    </a>
                  </Button>
                </div>
              )}

              {!proof.file_url && (
                <p className="text-sm text-muted-foreground">
                  No file was attached to this proof submission.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
};

export default StudentProof;
