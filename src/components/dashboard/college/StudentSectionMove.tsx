import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Section { cohort: string; students: number }

const NEW = "__new__";

/** Move one student to another section (migration 145). Shown inside the student's profile. */
const StudentSectionMove = ({ studentId, onMoved }: { studentId: string; onMoved?: () => void }) => {
  const { toast } = useToast();
  const [current, setCurrent] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc("tpo_sections" as never),
      supabase.from("student_profiles").select("cohort").eq("id", studentId).maybeSingle(),
    ]);
    setSections(Array.isArray(s) ? (s as unknown as Section[]) : []);
    const cohort = ((p as { cohort?: string | null } | null)?.cohort ?? null);
    setCurrent(cohort);
    setChoice(cohort ?? "");
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  const target = choice === NEW ? typed.trim() : choice;
  const ready = target.length > 0 && target !== current;

  const move = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("tpo_move_student_section" as never, {
      _student_id: studentId, _cohort: target,
    } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Could not move the student", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { released_squad?: boolean; cohort?: string };
    toast({
      title: `Moved to ${r?.cohort ?? target}`,
      description: r?.released_squad
        ? "Their old squad seat was released. They are in the reserve pool for the new section."
        : "No squad seat changed.",
    });
    setTyped("");
    void load();
    onMoved?.();
  };

  return (
    <section>
      <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Section{current ? ` · ${current}` : ""}
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Choose a section" /></SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.cohort} value={s.cohort}>{s.cohort} ({s.students})</SelectItem>
            ))}
            <SelectItem value={NEW}>A new section…</SelectItem>
          </SelectContent>
        </Select>
        {choice === NEW && (
          <Input className="h-9 w-[160px]" placeholder="e.g. CSE-D" value={typed}
            onChange={(e) => setTyped(e.target.value)} />
        )}
        <Button size="sm" disabled={!ready || saving} onClick={() => void move()}>
          {saving ? "Moving…" : "Move"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        A squad plays inside one section. If this student is in a squad of a different section, the seat is released
        and they wait in the reserve pool for you to place.
      </p>
    </section>
  );
};

export default StudentSectionMove;
