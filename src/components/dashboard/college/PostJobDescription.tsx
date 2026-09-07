import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const JOB_TYPES = ["Internship", "Full-time", "Part-time"];

/**
 * A college posts a real job description twice over: it becomes a listing on
 * the student job board (same job_opportunities table Admin's Manage Jobs
 * page already reads), and its text becomes real source material the Daily
 * Lot engine can quote from instead of inventing a job phrase — see
 * lot-writer's real-JD lookup.
 */
const PostJobDescription = () => {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [location, setLocation] = useState("Remote");
  const [jobType, setJobType] = useState("Internship");
  const [applyLink, setApplyLink] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();

  const reset = () => {
    setRole(""); setCompanyName(""); setLocation("Remote");
    setJobType("Internship"); setApplyLink(""); setDescription("");
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

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("job_opportunities").insert({
      role: role.trim(),
      company_name: companyName.trim(),
      location: location.trim() || "Remote",
      job_type: jobType,
      apply_link: applyLink.trim(),
      description: description.trim(),
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

    toast({ title: "Job description posted", description: "Visible to students, and now real source material for daily tasks." });
    reset();
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

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g., Backend Developer" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g., Acme Corp" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} />
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
              <Label>Apply link</Label>
              <Input value={applyLink} onChange={(e) => setApplyLink(e.target.value)} placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
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
