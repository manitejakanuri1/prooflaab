import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";

interface GenerateRecruiterLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
}

export function GenerateRecruiterLinkModal({ open, onOpenChange, collegeId }: GenerateRecruiterLinkModalProps) {
  const [branch, setBranch] = useState("All");
  const [batch, setBatch] = useState("All");
  const [minTrustScore, setMinTrustScore] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [topPerformersOnly, setTopPerformersOnly] = useState(false);
  const [expiryDays, setExpiryDays] = useState("7");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const filters = {
        branch: branch === "All" ? null : branch,
        batch: batch === "All" ? null : batch,
        min_trust_score: minTrustScore,
        verified_only: verifiedOnly,
        top_performers_only: topPerformersOnly,
      };

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiryDays));

      const { data, error } = await supabase
        .from('recruiter_links')
        .insert({
          college_id: collegeId,
          filters,
          expires_at: expiresAt.toISOString(),
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const link = `${window.location.origin}/recruiter/${data.id}`;
      setGeneratedLink(link);
      toast.success("Recruiter link generated successfully!");
    } catch (error) {
      console.error("Error generating link:", error);
      toast.error("Failed to generate recruiter link");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setGeneratedLink(null);
    setBranch("All");
    setBatch("All");
    setMinTrustScore(0);
    setVerifiedOnly(true);
    setTopPerformersOnly(false);
    setExpiryDays("7");
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Recruiter Shareable Page</DialogTitle>
        </DialogHeader>

        {!generatedLink ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Branch Filter</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Branches</SelectItem>
                  <SelectItem value="CSE">Computer Science</SelectItem>
                  <SelectItem value="ECE">Electronics & Communication</SelectItem>
                  <SelectItem value="ME">Mechanical</SelectItem>
                  <SelectItem value="EE">Electrical</SelectItem>
                  <SelectItem value="CE">Civil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Batch Filter</Label>
              <Select value={batch} onValueChange={setBatch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Batches</SelectItem>
                  <SelectItem value="2025">2025</SelectItem>
                  <SelectItem value="2026">2026</SelectItem>
                  <SelectItem value="2027">2027</SelectItem>
                  <SelectItem value="2028">2028</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Minimum Trust Score: {minTrustScore}</Label>
              <Slider
                value={[minTrustScore]}
                onValueChange={(values) => setMinTrustScore(values[0])}
                min={0}
                max={100}
                step={5}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="verified-only">Include only verified proofs</Label>
              <Switch
                id="verified-only"
                checked={verifiedOnly}
                onCheckedChange={setVerifiedOnly}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="top-performers">Include only top performers</Label>
              <Switch
                id="top-performers"
                checked={topPerformersOnly}
                onCheckedChange={setTopPerformersOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Link Expiry Duration</Label>
              <Select value={expiryDays} onValueChange={setExpiryDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="15">15 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={handleGenerate} 
              disabled={isGenerating}
              className="w-full"
            >
              {isGenerating ? "Generating..." : "Generate Link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <Label className="text-xs text-muted-foreground">Generated Link</Label>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  value={generatedLink}
                  readOnly
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This link will expire in {expiryDays} days. You can manage it from the "Recruiter Links" section.
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
