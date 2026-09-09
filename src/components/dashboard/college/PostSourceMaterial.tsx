import { useState } from "react";
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
const PostSourceMaterial = () => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { toast } = useToast();

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

    toast({ title: "Material submitted", description: "Now real source material for daily tasks on matching topics." });
    reset();
    setOpen(false);
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

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., TCS technical round — hash maps" />
            </div>

            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                placeholder="Paste a real question your students were asked, or reference material worth grounding a daily task in. This text is what daily tasks on a matching topic will be grounded in."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
