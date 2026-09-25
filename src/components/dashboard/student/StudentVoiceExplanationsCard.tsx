import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, Loader2, CheckCircle, XCircle } from "lucide-react";
import { format, isValid } from "date-fns";
import { useVoiceExplanations, type VoiceExplanation } from "@/hooks/useVoiceExplanations";

/**
 * Where a completed "Explain 60s" recording actually shows up (Step 6G) -
 * VoiceExplainModal.tsx's "Saved. It will appear in your build-log" had no
 * destination until this. Deliberately narrow: transcript, status and
 * score only, no audio playback and no storage path of any kind - nothing
 * here can be turned into a link to the private GCS object.
 */
function statusBadge(v: VoiceExplanation) {
  const status = v.transcription_status ?? "completed"; // legacy sync-path rows predate this column's default
  if (status === "failed") {
    return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
  }
  if (status === "pending" || status === "processing") {
    return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>;
  }
  if (v.status === "scored") {
    return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle className="h-3 w-3" /> Scored</Badge>;
  }
  return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle className="h-3 w-3" /> Completed</Badge>;
}

const StudentVoiceExplanationsCard = () => {
  const { data: explanations, isLoading } = useVoiceExplanations();

  if (isLoading || !explanations || explanations.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Spoken Explanations
          <Badge variant="outline" className="ml-auto">{explanations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {explanations.map((v) => {
          const when = new Date(v.created_at);
          return (
            <div key={v.id} className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium">{v.tasks?.title ?? "General explanation"}</span>
                <div className="flex items-center gap-2">
                  {v.communication_score != null && (
                    <Badge variant="outline" className="font-medium">{v.communication_score}/100</Badge>
                  )}
                  {statusBadge(v)}
                </div>
              </div>
              {v.transcription_status === "failed" ? (
                <p className="text-xs text-destructive">{v.transcription_error || "Could not transcribe this recording."}</p>
              ) : v.transcript ? (
                <p className="text-sm text-muted-foreground line-clamp-2">{v.transcript}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">Still being written down…</p>
              )}
              {v.communication_notes && (
                <p className="text-xs text-muted-foreground">{v.communication_notes}</p>
              )}
              <p className="text-xs text-muted-foreground">{isValid(when) ? format(when, "MMM dd, yyyy h:mm a") : ""}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default StudentVoiceExplanationsCard;
