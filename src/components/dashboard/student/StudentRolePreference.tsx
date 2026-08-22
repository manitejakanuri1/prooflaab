import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

interface Prefs {
  target_role: string | null;
  secondary_roles: string[];
  work_preference: "internship" | "full_time" | "either";
  preferred_locations: string[];
  open_to_relocate: boolean;
}

const WORK = [
  { value: "internship", label: "Internship" },
  { value: "full_time",  label: "Full time" },
  { value: "either",     label: "Either" },
] as const;

/**
 * Role preference — what you are aiming at.
 *
 * The target role was asked for during onboarding on both paths and then had
 * nowhere to be seen or changed, so a student whose plans moved in second year
 * was stuck with the answer they gave in first. It is carried forward here, and
 * from here it is editable.
 */
const StudentRolePreference = () => {
  const { profile } = useStudentProfile();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [role, setRole] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("student_profiles")
      .select("target_role, secondary_roles, work_preference, preferred_locations, open_to_relocate")
      .eq("id", profile.id)
      .maybeSingle();
    setPrefs((data ?? {
      target_role: null, secondary_roles: [], work_preference: "either",
      preferred_locations: [], open_to_relocate: true,
    }) as unknown as Prefs);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Partial<Prefs>, said: string) => {
    if (!profile?.id || !prefs) return;
    setBusy(true);
    const { error } = await supabase
      .from("student_profiles")
      .update(patch as never)
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      return;
    }
    setPrefs({ ...prefs, ...patch });
    toast({ title: said });
  };

  if (!prefs) return <Skeleton className="h-64 w-full rounded-xl" />;

  const addRole = () => {
    const v = role.trim();
    if (!v) return;
    if (!prefs.target_role) { void save({ target_role: v }, `Aiming at ${v}`); }
    else if (!prefs.secondary_roles.includes(v)) {
      void save({ secondary_roles: [...prefs.secondary_roles, v] }, `${v} added as a backup role`);
    }
    setRole("");
  };

  const addPlace = () => {
    const v = place.trim();
    if (!v || prefs.preferred_locations.includes(v)) { setPlace(""); return; }
    void save({ preferred_locations: [...prefs.preferred_locations, v] }, `${v} added`);
    setPlace("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            The role you are aiming at
          </span>
          <p className="text-2xl font-semibold mt-1">
            {prefs.target_role ?? <span className="text-muted-foreground text-lg">Not set yet</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">
            This is what your resume is scored against, and what a recruiter filters on. Changing it
            changes what "match" means on your scorecard.
          </p>

          {prefs.secondary_roles.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {prefs.secondary_roles.map((r) => (
                <Badge key={r} variant="outline" className="font-normal gap-1">
                  {r}
                  <button
                    type="button"
                    onClick={() => void save(
                      { secondary_roles: prefs.secondary_roles.filter((x) => x !== r) },
                      `${r} removed`,
                    )}
                    className="hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="mt-3 flex gap-2 flex-wrap">
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
              placeholder={prefs.target_role ? "Add a backup role" : "Backend Developer"}
              className="h-9 flex-1 min-w-[180px]"
            />
            <Button className="h-9" disabled={busy || !role.trim()} onClick={addRole}>
              {prefs.target_role ? "Add" : "Set"}
            </Button>
            {prefs.target_role && (
              <Button
                variant="ghost"
                className="h-9"
                disabled={busy}
                onClick={() => void save({ target_role: null }, "Target role cleared")}
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            What you are looking for
          </span>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {WORK.map((w) => {
              const on = prefs.work_preference === w.value;
              return (
                <button
                  key={w.value}
                  type="button"
                  disabled={busy}
                  onClick={() => void save({ work_preference: w.value }, `Looking for: ${w.label.toLowerCase()}`)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    on ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <p className="text-sm font-medium">{w.label}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Where
          </span>

          <div className="mt-3 flex flex-wrap gap-2">
            {prefs.preferred_locations.length === 0 && (
              <p className="text-sm text-muted-foreground">Anywhere — no preference recorded.</p>
            )}
            {prefs.preferred_locations.map((l) => (
              <Badge key={l} variant="outline" className="font-normal gap-1">
                {l}
                <button
                  type="button"
                  onClick={() => void save(
                    { preferred_locations: prefs.preferred_locations.filter((x) => x !== l) },
                    `${l} removed`,
                  )}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>

          <div className="mt-3 flex gap-2 flex-wrap">
            <Input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPlace(); } }}
              placeholder="Hyderabad"
              className="h-9 flex-1 min-w-[180px]"
            />
            <Button className="h-9" disabled={busy || !place.trim()} onClick={addPlace}>Add</Button>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <Label htmlFor="relocate" className="text-sm font-medium">Open to relocating</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Off means you only want roles in the places listed above.
              </p>
            </div>
            <Switch
              id="relocate"
              checked={prefs.open_to_relocate}
              disabled={busy}
              onCheckedChange={(on) => void save(
                { open_to_relocate: on },
                on ? "Open to relocating" : "Staying where you are",
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentRolePreference;
