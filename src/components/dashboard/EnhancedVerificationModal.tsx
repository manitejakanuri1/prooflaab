import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  XCircle, 
  Brain, 
  Github, 
  Shield, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Info,
  Send
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { IntegrityContextPanel } from "./IntegrityContextPanel";

interface VerificationData {
  id: string;
  ai_score: number | null;
  ai_summary: string | null;
  ai_feedback: string | null;
  authenticity_score: number | null;
  commit_count: number | null;
  unique_contributors: number | null;
  conceptual_score: number | null;
  trust_score: number | null;
  trust_change: number | null;
  status: string;
  admin_review_status: string | null;
  review_flag: boolean;
  student_id: string;
  task_id: string;
  declaration_acknowledged?: boolean;
  declaration_text?: string | null;
  reflection_requested?: boolean;
  conceptual_tests?: Array<{
    status: string;
    questions: any[];
  }>;
}

interface EnhancedVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: VerificationData | null;
  studentName?: string;
  taskTitle?: string;
  onRefetch?: () => void;
}

const EnhancedVerificationModal = ({ 
  open, 
  onOpenChange, 
  data, 
  studentName,
  taskTitle,
  onRefetch 
}: EnhancedVerificationModalProps) => {
  const { user } = useAuth();
  const [overrideReason, setOverrideReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!data) return null;

  const trustScore = data.trust_score ?? 0;
  const needsReview = trustScore < 10 || data.review_flag;
  const isConceptualPending = data.conceptual_tests?.some(t => t.status === 'pending');
  const isConceptualEvaluating = data.conceptual_tests?.some(t => t.status === 'submitted');

  const handleOverride = async (action: 'verified' | 'rejected') => {
    if (!overrideReason.trim() && action === 'rejected') {
      toast.error('Please provide a reason for rejection');
      return;
    }

    setIsSubmitting(true);
    try {
      // Get reviewer name
      const { data: collegeData } = await supabase
        .from('colleges')
        .select('name')
        .eq('user_id', user?.id)
        .single();

      const reviewerName = collegeData?.name || user?.email || 'Unknown Reviewer';

      // Update proof status
      const { error: updateError } = await supabase
        .from('proof_uploads')
        .update({
          status: action === 'verified' ? 'Verified' : 'Rejected',
          admin_review_status: action === 'verified' ? 'Verified' : 'Rejected',
          review_flag: false,
          reviewer_id: user?.id,
          reviewed_by_name: reviewerName,
          review_override_reason: overrideReason || null,
          reviewed_at: new Date().toISOString(),
          review_comment: overrideReason || null
        })
        .eq('id', data.id);

      if (updateError) throw updateError;

      // Log to audit_logs
      await supabase
        .from('audit_logs')
        .insert({
          user_id: user?.id,
          action: 'manual_review_override',
          table_name: 'proof_uploads',
          record_id: data.id,
          old_values: {
            status: data.status,
            trust_score: trustScore
          },
          new_values: {
            status: action === 'verified' ? 'Verified' : 'Rejected',
            trust_score: trustScore,
            reviewer: reviewerName,
            reason: overrideReason
          }
        });

      // Send notification to student
      await supabase
        .from('notifications')
        .insert({
          student_id: data.student_id,
          type: 'review',
          title: action === 'verified' ? 'Proof Manually Approved ✅' : 'Proof Rejected ❌',
          message: action === 'verified' 
            ? `Your proof was manually reviewed and approved by ${reviewerName}.`
            : `Your proof was rejected by ${reviewerName}. Reason: ${overrideReason}`,
          is_read: false
        });

      toast.success(`Proof ${action === 'verified' ? 'approved' : 'rejected'} successfully`, {
        description: `Manual override logged for audit trail`
      });

      onRefetch?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Override error:', error);
      toast.error('Failed to process override', { description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendToReviewer = async () => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('proof_uploads')
        .update({
          review_flag: true,
          status: 'needs_review'
        })
        .eq('id', data.id);

      if (error) throw error;

      // Notify admins
      const { data: admins } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (admins) {
        const notifications = admins.map(admin => ({
          admin_user_id: admin.user_id,
          type: 'proof',
          title: '⚠️ Manual Review Required',
          message: `${studentName} submission needs manual review (Trust Score: ${trustScore}/100)`,
          link: '/admin/proof-submissions',
          is_read: false
        }));

        await supabase
          .from('admin_notifications')
          .insert(notifications);
      }

      toast.success('Sent to manual review queue', {
        description: 'Admins have been notified'
      });

      onRefetch?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Send to reviewer error:', error);
      toast.error('Failed to send to review', { description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Enhanced Verification Review
            {needsReview && (
              <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Needs Review
              </Badge>
            )}
          </DialogTitle>
          {studentName && taskTitle && (
            <p className="text-sm text-muted-foreground">
              {studentName} · {taskTitle}
            </p>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Content - Left Column */}
          <div className="lg:col-span-2 space-y-4">
          {/* Alert Banner for Low Trust Score */}
          {needsReview && (
            <Card className="border-orange-300 bg-orange-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-orange-900 mb-1">
                      ⚠️ This submission requires human validation
                    </h4>
                    <p className="text-sm text-orange-800">
                      Low cognitive integrity score detected. The AI confidence is insufficient for automatic approval.
                      Please review all metrics carefully before making a decision.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pending Conceptual Notice */}
          {isConceptualPending && (
            <Card className="border-yellow-300 bg-yellow-50">
              <CardContent className="p-3">
                <p className="text-sm text-yellow-900 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Pending Conceptual Evaluation - Student needs to answer questions
                </p>
              </CardContent>
            </Card>
          )}

          {isConceptualEvaluating && (
            <Card className="border-blue-300 bg-blue-50">
              <CardContent className="p-3">
                <p className="text-sm text-blue-900 flex items-center gap-2">
                  <Info className="h-4 w-4 animate-spin" />
                  Conceptual answers are being evaluated...
                </p>
              </CardContent>
            </Card>
          )}

          {/* Conceptual Understanding Section */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                Conceptual Understanding
              </h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      Conceptual Score
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Measures understanding of core concepts through AI-evaluated Q&A
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                    <span className="font-bold">{data.conceptual_score ?? 'N/A'} / 100</span>
                  </div>
                  <Progress value={data.conceptual_score ?? 0} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      AI Likelihood
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Probability that code was AI-generated vs human-written
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                    <span className="font-bold">{data.ai_score ? (100 - data.ai_score) : 'N/A'}%</span>
                  </div>
                  <Progress value={data.ai_score ? (100 - data.ai_score) : 0} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      Commit Authenticity
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Analyzes commit patterns to verify genuine development work
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                    <span className="font-bold">{data.authenticity_score ?? 'N/A'} / 100</span>
                  </div>
                  <Progress value={data.authenticity_score ?? 0} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Summary */}
          {data.ai_summary && (
            <Card>
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2">AI Analysis Summary</h4>
                <p className="text-sm text-muted-foreground">{data.ai_summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Trust Score Section */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Trust Score Impact
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cognitive Integrity Score</span>
                  <div className="flex items-center gap-2">
                    <Progress value={trustScore} className="h-3 w-32" />
                    <span className="text-2xl font-bold">{trustScore}/100</span>
                  </div>
                </div>

                {data.trust_change !== null && data.trust_change !== 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    {data.trust_change > 0 ? (
                      <>
                        <TrendingUp className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-green-600">
                          Trust Adjusted by: +{data.trust_change}
                        </span>
                      </>
                    ) : (
                      <>
                        <TrendingDown className="h-4 w-4 text-red-600" />
                        <span className="font-medium text-red-600">
                          Trust Adjusted by: {data.trust_change}
                        </span>
                      </>
                    )}
                  </div>
                )}

                <div className="text-sm space-y-1">
                  <p className="flex items-center gap-2">
                    <span className="font-medium">Reason:</span>
                    <span className="text-muted-foreground">
                      {trustScore < 30 ? 'Critical issues detected across multiple metrics' : 
                       trustScore < 50 ? 'Moderate concerns in verification checks' :
                       trustScore < 70 ? 'Some minor concerns detected' :
                       'Strong performance across all metrics'}
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="font-medium">Confidence:</span>
                    <span className="text-muted-foreground">
                      {data.ai_score ? `${data.ai_score}%` : 'N/A'}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Reviewer Controls */}
          {needsReview && (
            <Card className="border-orange-300">
              <CardContent className="p-4 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  ⚙️ Reviewer Controls
                </h3>
                
                <Textarea
                  placeholder="Enter your decision reason (required for rejection)..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="min-h-[80px]"
                />

                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => handleOverride('verified')}
                    disabled={isSubmitting}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Anyway
                  </Button>
                  
                  <Button
                    onClick={() => handleOverride('rejected')}
                    disabled={isSubmitting}
                    variant="destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>

                  <Button
                    onClick={handleSendToReviewer}
                    disabled={isSubmitting}
                    variant="outline"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send to Reviewer
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  ℹ️ All actions are logged in audit trail with reviewer email and timestamp
                </p>
              </CardContent>
            </Card>
          )}

          {/* Status */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm font-medium">Current Status:</span>
            <Badge 
              variant={data.status === 'Verified' ? 'default' : data.status === 'Rejected' ? 'destructive' : 'secondary'}
              className="flex items-center gap-1"
            >
              {data.status === 'Verified' ? (
                <><CheckCircle className="h-3 w-3" /> Verified</>
              ) : data.status === 'Rejected' ? (
                <><XCircle className="h-3 w-3" /> Rejected</>
              ) : data.status === 'needs_review' ? (
                <><AlertTriangle className="h-3 w-3" /> Needs Review</>
              ) : (
                'Under Review'
              )}
            </Badge>
          </div>
          </div>

          {/* Integrity Context Panel - Right Column */}
          <div className="lg:col-span-1">
            <IntegrityContextPanel
              declarationAcknowledged={data.declaration_acknowledged}
              declarationText={data.declaration_text}
              reflectionRequested={data.reflection_requested}
              aiAuthorshipRisk={data.ai_score ? 100 - data.ai_score : undefined}
              conceptualScore={data.conceptual_score ?? undefined}
              trustScore={data.trust_score ?? undefined}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancedVerificationModal;