import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mic, Loader2, CheckCircle, XCircle, ShieldCheck, MessageSquare, MinusCircle, Play } from "lucide-react";
import { format, isValid } from "date-fns";
import { useVoiceExplanations, type VoiceExplanation } from "@/hooks/useVoiceExplanations";
import { useRecordingAudio } from "@/hooks/useRecordingAudio";
import { recordingStatus, STATUS_LABEL, type RecordingStatusKind } from "@/lib/voiceStatus";

/**
 * Where a completed "Explain 60s" recording actually shows up (Step 6G) -
 * VoiceExplainModal.tsx's "Saved. It will appear in your build-log" had no
 * destination until this. Deliberately narrow: transcript, status and
 * score only, no storage path of any kind in the list or the detail view -
 * nothing here can be turned into a link to the private GCS object. The
 * one exception is the recording itself, played the same way
 * RecordingPlayback plays it: downloaded with the student's own token
 * (files-service only serves the owner) into a temporary blob: URL that is
 * revoked when the dialog closes - never a public or shareable link.
 *
 * Step 6H: distinguishes a browser-authored transcript (typed/self-reported,
 * client-side speech recognition, or - as a real staging test found -
 * simply POSTed with no audio at all) from a server-verified one (the async
 * pipeline's own worker actually ran Whisper against audio the student
 * actually uploaded). Both are shown; only the second is labelled verified,
 * matching the same gate now applied everywhere the score is used for
 * anything (trust-compute, the recruiter-facing functions - migration 46).
 */
const BADGE_STYLE: Record<RecordingStatusKind, { className: string; icon: JSX.Element }> = {
  failed: { className: "bg-red-100 text-red-800 border-red-200", icon: <XCircle className="h-3 w-3" /> },
  transcribing: { className: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  scoring: { className: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  scored: { className: "bg-green-100 text-green-800 border-green-200", icon: <CheckCircle className="h-3 w-3" /> },
  not_scored: { className: "bg-muted text-muted-foreground", icon: <MinusCircle className="h-3 w-3" /> },
};

/** Rules in lib/voiceStatus.ts (tested there). */
function statusBadge(v: VoiceExplanation) {
  const kind = recordingStatus(v);
  const style = BADGE_STYLE[kind];
  return (
    <Badge variant="outline" className={`${style.className} gap-1`} data-status={kind}>
      {style.icon} {STATUS_LABEL[kind]}
    </Badge>
  );
}

function provenanceBadge(v: VoiceExplanation) {
  if (v.transcript_source === "server") {
    return (
      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 gap-1">
        <ShieldCheck className="h-3 w-3" /> Server-verified
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-muted text-muted-foreground gap-1">
      <MessageSquare className="h-3 w-3" /> Self-reported
    </Badge>
  );
}

function VoiceExplanationDetail({ v, onClose }: { v: VoiceExplanation; onClose: () => void }) {
  // Authenticated download -> temporary blob: URL, revoked on close; retryable.
  const audio = useRecordingAudio(v.storage_path);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" /> {v.tasks?.title ?? "General explanation"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {statusBadge(v)}
            {provenanceBadge(v)}
            {v.communication_score != null && (
              <Badge variant="outline" className="font-medium">{v.communication_score}/100</Badge>
            )}
          </div>

          {v.transcription_status === "failed" ? (
            <p className="text-sm text-destructive">{v.transcription_error || "Could not transcribe this recording."}</p>
          ) : (
            <div className="rounded-lg border p-3 max-h-56 overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap">{v.transcript || "Still being written down…"}</p>
            </div>
          )}

          {v.communication_notes && (
            <p className="text-sm text-muted-foreground">{v.communication_notes}</p>
          )}

          <div>
            {audio.url ? (
              <audio controls className="w-full" src={audio.url} />
            ) : (
              <Button variant="outline" size="sm" onClick={audio.load} disabled={audio.loading}>
                {audio.loading
                  ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  : <Play className="h-4 w-4 mr-1" />}
                {audio.failed ? "Could not load - try again" : "Play recording"}
              </Button>
            )}
            {audio.failed && (
              <p className="text-xs text-destructive mt-1">Could not open the recording. Check your connection and try again.</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {isValid(new Date(v.created_at)) ? format(new Date(v.created_at), "MMM dd, yyyy h:mm a") : ""}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const StudentVoiceExplanationsCard = () => {
  const { data: explanations, isLoading } = useVoiceExplanations();
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading || !explanations || explanations.length === 0) return null;
  const opened = explanations.find((v) => v.id === openId) ?? null;

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
        {explanations.map((v) => (
          <button
            key={v.id}
            type="button"
            data-voice-id={v.id}
            onClick={() => setOpenId(v.id)}
            className="w-full text-left rounded-lg border p-3 space-y-1.5 hover:bg-muted/40 transition-colors"
          >
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
            <p className="text-xs text-muted-foreground">
              {isValid(new Date(v.created_at)) ? format(new Date(v.created_at), "MMM dd, yyyy h:mm a") : ""}
            </p>
          </button>
        ))}
      </CardContent>
      {opened && <VoiceExplanationDetail v={opened} onClose={() => setOpenId(null)} />}
    </Card>
  );
};

export default StudentVoiceExplanationsCard;
