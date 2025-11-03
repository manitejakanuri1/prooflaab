import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, Brain, Github, Shield, TrendingUp } from "lucide-react";

interface VerificationData {
  moss_score: number | null;
  moss_url: string | null;
  ai_score: number | null;
  ai_summary: string | null;
  ai_feedback: string | null;
  authenticity_score: number | null;
  commit_count: number | null;
  unique_contributors: number | null;
  trust_change: number | null;
  status: string;
  admin_review_status: string | null;
}

interface VerificationSummaryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: VerificationData | null;
  studentName?: string;
  taskTitle?: string;
}

const VerificationSummaryModal = ({ 
  open, 
  onOpenChange, 
  data, 
  studentName,
  taskTitle 
}: VerificationSummaryModalProps) => {
  if (!data) return null;

  const getMossScoreBadge = (score: number | null) => {
    if (score === null) return null;
    
    if (score < 20) {
      return <Badge className="bg-green-500 text-white">Unique ({score}%)</Badge>;
    } else if (score < 60) {
      return <Badge className="bg-orange-500 text-white">Similar ({score}%)</Badge>;
    } else {
      return <Badge className="bg-red-500 text-white">High Risk ({score}%)</Badge>;
    }
  };

  const getOriginalityBadge = (score: number | null) => {
    if (score === null) return null;
    
    if (score > 70) {
      return <Badge className="bg-green-500 text-white">High ({score}%)</Badge>;
    } else if (score > 40) {
      return <Badge className="bg-orange-500 text-white">Medium ({score}%)</Badge>;
    } else {
      return <Badge className="bg-red-500 text-white">Low ({score}%)</Badge>;
    }
  };

  const getAuthenticityBadge = (score: number | null) => {
    if (score === null) return null;
    
    if (score > 60) {
      return <Badge className="bg-green-500 text-white">Authentic ({score})</Badge>;
    } else if (score > 30) {
      return <Badge className="bg-orange-500 text-white">Moderate ({score})</Badge>;
    } else {
      return <Badge className="bg-red-500 text-white">Low ({score})</Badge>;
    }
  };

  const getTrustChangeBadge = (change: number | null) => {
    if (change === null) return null;
    
    if (change > 0) {
      return (
        <Badge className="bg-green-500 text-white flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          +{change} Points
        </Badge>
      );
    } else if (change < 0) {
      return (
        <Badge className="bg-red-500 text-white flex items-center gap-1">
          {change} Points
        </Badge>
      );
    } else {
      return <Badge variant="outline">No Change</Badge>;
    }
  };

  const isAutoVerified = data.admin_review_status === 'Auto-verified';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Verification Summary
            {isAutoVerified && (
              <Badge variant="outline" className="ml-2">
                Auto-verified
              </Badge>
            )}
          </DialogTitle>
          {studentName && taskTitle && (
            <p className="text-sm text-muted-foreground">
              {studentName} · {taskTitle}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* MOSS Score */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold">MOSS Plagiarism Check</h3>
                </div>
                {getMossScoreBadge(data.moss_score)}
              </div>
              <p className="text-sm text-muted-foreground">
                {data.moss_score !== null 
                  ? `Similarity score: ${data.moss_score}%. ${data.moss_score < 20 ? 'Original work detected.' : data.moss_score < 60 ? 'Some similarities found.' : 'High similarity detected - requires manual review.'}`
                  : 'MOSS check not completed yet.'}
              </p>
              {data.moss_url && (
                <a 
                  href={data.moss_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline mt-2 inline-block"
                >
                  View detailed MOSS report →
                </a>
              )}
            </CardContent>
          </Card>

          {/* AI Originality */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-purple-600" />
                  <h3 className="font-semibold">AI Originality Analysis</h3>
                </div>
                {getOriginalityBadge(data.ai_score)}
              </div>
              {data.ai_summary && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{data.ai_summary}</p>
                  {data.ai_feedback && (
                    <div className="bg-muted/50 p-3 rounded-md">
                      <p className="text-sm font-medium mb-1">AI Feedback:</p>
                      <p className="text-sm text-muted-foreground">{data.ai_feedback}</p>
                    </div>
                  )}
                </div>
              )}
              {!data.ai_summary && (
                <p className="text-sm text-muted-foreground">
                  AI analysis not completed yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* GitHub Authenticity */}
          {(data.authenticity_score !== null || data.commit_count !== null) && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Github className="h-5 w-5 text-gray-800" />
                    <h3 className="font-semibold">GitHub Commit Activity</h3>
                  </div>
                  {getAuthenticityBadge(data.authenticity_score)}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {data.commit_count !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Total Commits</p>
                      <p className="text-lg font-semibold">{data.commit_count}</p>
                    </div>
                  )}
                  {data.unique_contributors !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Contributors</p>
                      <p className="text-lg font-semibold">{data.unique_contributors}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Trust Score Adjustment */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Trust Score Adjustment</h3>
                </div>
                {getTrustChangeBadge(data.trust_change)}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {data.trust_change && data.trust_change > 0 
                  ? 'Strong performance across all verification metrics!'
                  : data.trust_change && data.trust_change < 0
                  ? 'Some concerns detected. Manual review recommended.'
                  : 'No trust score changes applied.'}
              </p>
            </CardContent>
          </Card>

          {/* Status */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-medium">Final Status:</span>
            <Badge 
              variant={data.status === 'Verified' ? 'default' : data.status === 'Rejected' ? 'destructive' : 'secondary'}
              className="flex items-center gap-1"
            >
              {data.status === 'Verified' ? (
                <><CheckCircle className="h-3 w-3" /> Verified</>
              ) : data.status === 'Rejected' ? (
                <><XCircle className="h-3 w-3" /> Rejected</>
              ) : (
                'Under Review'
              )}
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VerificationSummaryModal;
