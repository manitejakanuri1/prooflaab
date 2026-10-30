import { useCallback, useEffect, useState } from "react";
import RecordingPlayback from "./RecordingPlayback";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Mic } from "lucide-react";

interface Portfolio { is_public: boolean; slug: string | null }
interface Recording {
  id: string;
  storage_path: string;
  transcript: string | null;
  transcript_segments: import("@/lib/transcribeAudio").TranscriptSegment[] | null;
  duration_seconds: number | null;
  communication_score: number | null;
  created_at: string;
  audio_purged_at: string | null;
}

/**
 * Privacy — who can see what.
 *
 * One switch since migration 168: "Companies can see my profile and all my work"
 * (student_portfolios.is_public). On, companies see the profile, every finished
 * task with its answer, the voice words and the recordings, and the portfolio
 * link opens. Off (the default), no company sees anything. Weak areas are never
 * shown to a company. The college and the ProofLab team always see the work.
 */
const StudentPrivacy = () => {
  const { profile } = useStudentProfile();
  const { toast } = useToast();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const pf = await supabase.from("student_portfolios").select("is_public, slug")
      .eq("student_id", profile.id).maybeSingle();
    setPortfolio((pf.data ?? { is_public: false, slug: null }) as unknown as Portfolio);

    const { data: voice } = await supabase
      .from("voice_explanations")
      .select("id, storage_path, duration_seconds, communication_score, created_at, transcript, transcript_segments, audio_purged_at")
      .eq("student_id", profile.id)
      .is("withdrawn_at" as never, null)
      .order("created_at", { ascending: false });
    setRecordings((voice ?? []) as unknown as Recording[]);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  const setPortfolioPublic = async (on: boolean) => {
    if (!profile?.id) return;
    setBusy(true);
    // upsert, because a student who has never opened the portfolio tab has no
    // row yet and switching this on has to create one rather than fail.
    const { error } = await supabase
      .from("student_portfolios")
      .upsert({ student_id: profile.id, is_public: on } as never, { onConflict: "student_id" });
    setBusy(false);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    setPortfolio((p) => ({ is_public: on, slug: p?.slug ?? null }));
    toast({
      title: on ? "Companies can see your work" : "Companies cannot see your work",
      description: on
        ? "Approved companies can open your profile, your answers and your recordings. Your portfolio link opens."
        : "No company can find or open your profile. Your portfolio link is closed.",
    });
  };

  if (!profile) return <Skeleton className="h-64 w-full rounded-xl" />;


  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <Label htmlFor="companies-see-work" className="text-sm font-medium">
                Companies can see my profile and all my work
              </Label>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                Off by default. When on, approved companies can find you and see every lot you finished: your code
                or written answer, your voice words and your recordings. Each listen is recorded. Your portfolio
                link also opens. Companies never see your next-to-strengthen areas.
              </p>
              <p className="text-xs text-muted-foreground mt-2 max-w-prose">
                Your college and the ProofLab team always see your work and recordings, with the switch on or off.
              </p>
              {portfolio?.is_public && portfolio.slug && (
                <p className="font-mono text-xs text-primary mt-2 break-all">{`${window.location.origin}/portfolio/${portfolio.slug}`}</p>
              )}
            </div>
            <Switch
              id="companies-see-work"
              checked={portfolio?.is_public ?? false}
              disabled={busy}
              onCheckedChange={(on) => void setPortfolioPublic(on)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Your voice recordings
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {recordings.length}
            </span>
          </div>

          {recordings.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              None yet. When you record a 60-second explanation it appears here.
            </p>
          ) : (
            <div className="mt-3">
              {recordings.map((r) => (
                <div key={r.id} className="py-2.5 border-b last:border-b-0 space-y-2">
                <div className="flex items-center gap-3">
                  <Mic className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {format(new Date(r.created_at), "d MMM yyyy, h:mm a")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.duration_seconds ? `${r.duration_seconds}s` : "—"}
                      {r.communication_score != null && ` · scored ${r.communication_score}`}
                    </p>
                  </div>
                </div>
                <div className="pl-7">
                  <RecordingPlayback storagePath={r.storage_path} audioRemoved={!!r.audio_purged_at} transcript={r.transcript}
                                     segments={r.transcript_segments} />
                </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3 max-w-prose">
            Your recordings can't be deleted. We keep the audio of your 7 newest recordings (task and mock interview together). Older audio is removed automatically to save space. Your score, feedback and written words always stay in your history.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPrivacy;
