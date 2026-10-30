import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Setting { per_cohort: number | null; default_per_cohort: number; cohorts: number }

const DEFAULT = "default";

/** How many squads per section go through to the championship (migration 144). */
const QualifierSetting = () => {
  const { toast } = useToast();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [value, setValue] = useState(DEFAULT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("tpo_qualifier_setting" as never);
    if (error || !data) return;
    const s = data as unknown as Setting;
    setSetting(s);
    setValue(s.per_cohort == null ? DEFAULT : String(s.per_cohort));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("tpo_set_qualifiers" as never, {
      _per_cohort: value === DEFAULT ? null : Number(value),
    } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: "Applies when the league ends and squads are ranked." });
    void load();
  };

  if (!setting) return null;
  const changed = value !== (setting.per_cohort == null ? DEFAULT : String(setting.per_cohort));

  return (
    <Card><CardContent className="pt-5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Squads that qualify
      </span>
      <p className="text-sm text-muted-foreground mt-2 max-w-prose">
        When the league ends, this many of the best squads in each section go through to the championship.
        The default is {setting.default_per_cohort}{" "}
        {setting.cohorts <= 1
          ? `(you have one section, so the top ${setting.default_per_cohort} go through)`
          : `per section (you have ${setting.cohorts} sections)`}.
        A change applies the next time squads are ranked; squads already marked as qualified are not changed.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Default ({setting.default_per_cohort})</SelectItem>
            {/* MF-050: the default's own number is not offered twice */}
            {[1, 2, 3, 4, 5, 6, 7, 8].filter((n) => n !== setting.default_per_cohort).map((n) => (
              <SelectItem key={n} value={String(n)}>{n} per section</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={saving || !changed} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </CardContent></Card>
  );
};

export default QualifierSetting;
