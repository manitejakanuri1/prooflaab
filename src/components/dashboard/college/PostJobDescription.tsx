import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { applyHost } from "@/lib/applyLink";

const JOB_TYPES = ["Internship", "Full-time", "Part-time"];

/**
 * A college posts a real job into job_opportunities. Its own students see it on their Jobs page (migration 310,
 * owner 12 Nov 2026) with an Apply button that opens the https:// apply link; the Daily Lot engine can also quote
 * the text (lot-pipeline's real-JD lookup).
 */
const PostJobDescription = ({ onPosted }: { onPosted?: () => void }) => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [location, setLocation] = useState("Remote");
  const [jobType, setJobType] = useState("Internship");
  const [applyLink, setApplyLink] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const reset = () => {
    setRole(""); setCompanyName(""); setLocation("Remote");
    setJobType("Internship"); setApplyLink(""); setDescription(""); setDeadline("");
  };

  const submit = async () => {
    if (!role.trim() || !companyName.trim() || !applyLink.trim() || !description.trim()) {
      toast({
        title: "Missing details",
        description: "Role, company, apply link and description are all required.",
        variant: "destructive",
      });
      return;
    }
    if (!applyHost(applyLink.trim())) {
      toast({ title: "Check the apply link", description: "It must start with https:// (for example https://careers.acme.com/job/1).", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("job_opportunities").insert({
      role: role.trim(),
      company_name: companyName.trim(),
      location: location.trim() || "Remote",
      job_type: jobType,
      apply_link: applyLink.trim(),
      description: description.trim(),
      deadline: deadline || null,
      eligible_branch: "ALL",
      status: "approved",
      source: "college",
      created_by: user?.id ?? null,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Not posted", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Job posted", description: "Your students see it on their Jobs page until the last date." });
    reset();
    await qc.invalidateQueries({ queryKey: ["college-job-posts"] });
    onPosted?.();
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Briefcase className="h-4 w-4 mr-2" />
        Post Job Description
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post a job description</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your students see this job on their Jobs page until the last date, with an Apply button that opens your link.
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pjd-role">Role</Label>
                <Input id="pjd-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g., Backend Developer" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pjd-company">Company</Label>
                <Input id="pjd-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g., Acme Corp" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pjd-location">Location</Label>
                <Input id="pjd-location" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={jobType} onValueChange={setJobType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pjd-apply-link">Apply link</Label>
              <Input id="pjd-apply-link" value={applyLink} onChange={(e) => setApplyLink(e.target.value)} placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pjd-deadline">Last date to apply (optional)</Label>
              <Input id="pjd-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pjd-description">Description</Label>
              <Textarea id="pjd-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="Paste the real job description — responsibilities, requirements, skills. This text is what daily tasks will be grounded in."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Posting…" : "Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PostJobDescription;
