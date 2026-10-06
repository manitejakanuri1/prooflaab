import { useCallback, useEffect, useState } from "react";
import RecordingPlayback from "./RecordingPlayback";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Globe, Lock, School, Mic, Trash2 } from "lucide-react";

interface Portfolio { is_public: boolean; slug: string | null }
interface Recording {
  id: string;
  storage_path: string;
  transcript: string | null;
  transcript_segments: import("@/lib/transcribeAudio").TranscriptSegment[] | null;
  duration_seconds: number | null;
  communication_score: number | null;
  created_at: string;
}

const VISIBILITY = [
  { value: "public",  label: "Anyone with the link", icon: Globe,
    says: "Recruiters can find and open your profile." },
  { value: "college", label: "Your college only",    icon: School,
    says: "Your placement office sees it. Nobody outside does." },
  { value: "private", label: "Only you",             icon: Lock,
    says: "Nothing is shared. Your college still sees your activity for placements." },
] as const;

/**
 * Privacy — who can see what.
 *
 * Three separate decisions, because they really are separate: whether your
 * profile is findable, whether your portfolio page is live, and which individual
 * pieces of work are public. Each control writes the row it describes and says
 * in plain words what changes.
 */
const StudentPrivacy = () => {
  const { profile, refreshProfile } = useStudentProfile();
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
      .select("id, storage_path, duration_seconds, communication_score, created_at, transcript, transcript_segments")
      .eq("student_id", profile.id)
      .is("withdrawn_at" as never, null)
      .order("created_at", { ascending: false });
    setRecordings((voice ?? []) as unknown as Recording[]);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  const setVisibility = async (value: string) => {
    if (!profile?.id) return;
    setBusy(true);
    const { error } = await supabase
      .from("student_profiles")
      .update({ profile_visibility: value } as never)
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Visibility updated", description: VISIBILITY.find((v) => v.value === value)?.says });
    refreshProfile?.();
  };

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
      title: on ? "Your portfolio is live" : "Your portfolio is private",
      description: on
        ? "Anyone with the link can see it, including the scorecard on it."
        : "The link no longer opens for anyone but you.",
    });
  };

  /**
   * Deletes the row and the audio file, in that order.
   *
   * The row first, because that is the record the platform reads; a file left
   * behind is waste, but a row pointing at a file that is gone is a broken
   * screen. Both are removed here — the storage bucket now has a delete policy
   * for the owner, which it did not before.
   */
  const deleteRecording = async (rec: Recording) => {
    // A recording is evidence, so the row is never deleted: it is withdrawn
    // (transcript erased, marked withdrawn, no longer shown to anyone).
    const { error } = await supabase.rpc("withdraw_voice_explanation" as never, { _id: rec.id } as never);
    if (error) {
      toast({ title: "Not deleted", description: error.message, variant: "destructive" });
      return;
    }
    await supabase.storage.from("voice-explanations").remove([rec.storage_path]);
    setRecordings((list) => list.filter((r) => r.id !== rec.id));
    toast({
      title: "Recording deleted",
      description: "The audio and its transcript are gone. Any score it produced stays on your record.",
    });
  };

  if (!profile) return <Skeleton className="h-64 w-full rounded-xl" />;

  const current = (profile as unknown as { profile_visibility?: string }).profile_visibility ?? "public";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Who can see your profile
          </span>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {VISIBILITY.map((v) => {
              const Icon = v.icon;
              const on = current === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  disabled={busy}
                  onClick={() => void setVisibility(v.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    on ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${on ? "text-primary" : "text-muted-foreground"}`} />
                  <p className="text-sm font-medium mt-2">{v.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{v.says}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <Label htmlFor="portfolio-public" className="text-sm font-medium">
                Portfolio page
              </Label>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                A single page holding the Lots you passed, your skills and your scorecard, at a link you can
                paste into an application. Off by default.
              </p>
              {portfolio?.is_public && portfolio.slug && (
                <p className="font-mono text-xs text-primary mt-2 break-all">{`${window.location.origin}/portfolio/${portfolio.slug}`}</p>
              )}
            </div>
            <Switch
              id="portfolio-public"
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
              None yet. When you record a 60-second explanation it appears here, and you can
              delete it whenever you want.
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void deleteRecording(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="pl-7">
                  <RecordingPlayback storagePath={r.storage_path} transcript={r.transcript}
                                     segments={r.transcript_segments} />
                </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3 max-w-prose">
            Recordings are kept for the season and removed afterwards. The score a recording
            produced stays on your record either way.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPrivacy;
