import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Part A (migration 200, owner 31 Oct 2026): the admin pastes text or picks a PDF and says what it is for.
//   Daily Lot - stored as source pages and cut into bank questions straight away (live, no approval).
//   Roadmap   - stored for the roadmap writer, used for students whose weak skills it covers.
// Students never see the material or where it came from.

type Purpose = "lot" | "roadmap";

export default function AddMaterial({ onAdded }: { onAdded?: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("lot");
  const [busy, setBusy] = useState("");

  const readPdf = async (file: File) => {
    setBusy("Reading the PDF…");
    try {
      const { extractPdfText } = await import("@/lib/pdfText");
      const out = await extractPdfText(file, (m) => setBusy(m));
      setText(out.text.slice(0, 60000));
      if (!title) setTitle(file.name.replace(/\.pdf$/i, "").slice(0, 200));
      toast({ title: `Read ${out.pages} page${out.pages === 1 ? "" : "s"}`, description: out.text.length > 60000 ? "Only the first 60,000 characters are kept." : undefined });
    } catch (e) {
      toast({ title: "Could not read the PDF", description: (e as Error).message, variant: "destructive" });
    }
    setBusy("");
  };

  const save = async () => {
    setBusy("Saving…");
    const { data, error } = await supabase.rpc("admin_add_material" as never, { _title: title, _content: text, _purpose: purpose } as never);
    if (error) { setBusy(""); toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    const ids = ((data as { ids?: string[] } | null)?.ids ?? []);
    let stored = 0;
    if (purpose === "lot") {
      for (const [i, id] of ids.entries()) {
        setBusy(`Writing questions (${i + 1} of ${ids.length})…`);
        const { data: cut } = await supabase.functions.invoke("question-decompose", { body: { source_content_id: id } });
        stored += Number((cut as { stored?: number } | null)?.stored ?? 0);
      }
    }
    setBusy("");
    toast({
      title: "Saved",
      description: purpose === "lot"
        ? `${stored} question${stored === 1 ? "" : "s"} added to the bank. They become Daily Lots once written (within a day).`
        : "Used when the roadmap is written for students weak in these skills.",
    });
    setTitle(""); setText("");
    onAdded?.();
  };

  return (
    <Card data-testid="add-material">
      <CardContent className="pt-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Add material</h2>
          <p className="text-sm text-muted-foreground">
            Paste text or choose a PDF. Students never see it or where it came from.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="material-title">Title</Label>
          <Input id="material-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
                 placeholder="e.g. SQL joins - interview notes" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="material-text">Text</Label>
          <Textarea id="material-text" value={text} rows={8} onChange={(e) => setText(e.target.value.slice(0, 60000))}
                    placeholder="Paste the material here, or choose a PDF below" />
          <div className="flex flex-wrap items-center gap-3">
            <Input type="file" accept="application/pdf" className="max-w-xs"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) void readPdf(f); e.target.value = ""; }} />
            <span className="text-xs text-muted-foreground">{text.length.toLocaleString()} / 60,000 characters</span>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Use it for</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="purpose" checked={purpose === "lot"} onChange={() => setPurpose("lot")} />
              Daily Lot (cut into bank questions now)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="purpose" checked={purpose === "roadmap"} onChange={() => setPurpose("roadmap")} />
              Roadmap (guides roadmap tasks on these skills)
            </label>
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button disabled={!!busy || title.trim().length < 3 || text.trim().length < 80} onClick={() => void save()}>
            Save material
          </Button>
          {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
