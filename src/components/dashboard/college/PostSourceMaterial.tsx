import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDay } from "@/lib/ist";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * A college submits real interview questions or reference material its own
 * students have actually faced — a placement round, a recurring technical
 * question, anything worth grounding a Daily Lot in. It lands in
 * source_content (via college_submit_source_content), the same table the
 * Crawl4AI collector writes to — lot-writer reads from there when it finds
 * no matching job posting, so this becomes real source material the next
 * student on a matching topic sees, exactly like a real job description does.
 */
interface Mine { id: string; title: string | null; submitted_at: string; lot_written: boolean; times_given: number; hidden: boolean }

// C3: what happened to each piece, in plain words.
const statusOf = (m: Mine) =>
  m.hidden ? "Hidden by ProofLab - not used"
  : m.times_given > 0 ? `Used in ${m.times_given} daily task${m.times_given === 1 ? "" : "s"}`
  : m.lot_written ? "Daily task written - not given to a student yet"
  : "Waiting - used when a student gets a matching topic";

const PostSourceMaterial = () => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ["college-my-source-material"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("college_my_source_material" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Mine[];
    },
  });

  const reset = () => { setTitle(""); setContent(""); };

  const submit = async () => {
    if (title.trim().length < 3 || content.trim().length < 80) {
      toast({
        title: "Needs more detail",
        description: "Title (3+ chars) and content (80+ chars) are both required — this becomes real source material, not a label.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc("college_submit_source_content", {
      _title: title.trim(),
      _content: content.trim(),
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Not submitted", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Material submitted", description: "It is listed under \"Already submitted\" in this window, with what happened to it." });
    reset();
    void qc.invalidateQueries({ queryKey: ["college-my-source-material"] });
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BookOpen className="h-4 w-4 mr-2" />
        Submit Interview Material
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit real interview material</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Paste real questions your students were asked in a company interview or placement test. Add the company
            and role if you know them. ProofLab uses this text to write daily tasks on matching topics.
          </p>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="psm-title">Title</Label>
              <Input id="psm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., TCS technical round — hash maps" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="psm-content">Content</Label>
              <Textarea id="psm-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                placeholder="e.g. Infosys, Systems Engineer, campus round Nov 2026: 1) Find the second largest number in an array without sorting. 2) What is the difference between a process and a thread?"
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Already submitted</p>
            {mine.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p>
            : mine.error ? <p className="text-xs text-alert">Could not load your material: {(mine.error as Error).message}</p>
            : !mine.data?.length ? <p className="text-xs text-muted-foreground">Nothing submitted yet.</p>
            : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto" data-testid="college-material-list">
                {mine.data.map((m) => (
                  <li key={m.id} className="text-xs">
                    <span className="font-medium">{m.title || "Untitled"}</span>
                    <span className="text-muted-foreground"> · {fmtDay(m.submitted_at)} · {statusOf(m)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PostSourceMaterial;
