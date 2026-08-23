import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Globe, Lock, School } from "lucide-react";

interface Portfolio { is_public: boolean; slug: string | null }
interface Proof {
  id: string;
  is_public: boolean;
  status: string;
  submitted_at: string;
  tasks: { title: string } | null;
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
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const [pf, pr] = await Promise.all([
      supabase.from("student_portfolios").select("is_public, slug")
        .eq("student_id", profile.id).maybeSingle(),
      supabase.from("proof_uploads").select("id, is_public, status, submitted_at, tasks(title)")
        .eq("student_id", profile.id).order("submitted_at", { ascending: false }).limit(25),
    ]);
    setPortfolio((pf.data ?? { is_public: false, slug: null }) as unknown as Portfolio);
    setProofs((pr.data ?? []) as unknown as Proof[]);
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

  const setProofPublic = async (proof: Proof, on: boolean) => {
    const { error } = await supabase.rpc("set_proof_publicity" as never, {
      p_proof_id: proof.id, p_is_public: on,
    } as never);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    setProofs((list) => (list ?? []).map((p) => (p.id === proof.id ? { ...p, is_public: on } : p)));
  };

  if (!profile || !proofs) return <Skeleton className="h-64 w-full rounded-xl" />;

  const current = (profile as unknown as { profile_visibility?: string }).profile_visibility ?? "public";
  const publicProofs = proofs.filter((p) => p.is_public).length;

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
                A single page holding your proof, your skills and your scorecard, at a link you can
                paste into an application. Off by default.
              </p>
              {portfolio?.is_public && portfolio.slug && (
                <p className="font-mono text-xs text-primary mt-2">/p/{portfolio.slug}</p>
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
              Individual pieces of work
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {publicProofs} of {proofs.length} public
            </span>
          </div>

          {proofs.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">
              Nothing submitted yet. Each piece of work gets its own switch here.
            </p>
          ) : (
            <div className="mt-3">
              {proofs.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5 border-b last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{p.tasks?.title ?? "Submitted work"}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(p.submitted_at), "d MMM yyyy")}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-normal">{p.status}</Badge>
                  <Switch
                    checked={p.is_public}
                    onCheckedChange={(on) => void setProofPublic(p, on)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPrivacy;
