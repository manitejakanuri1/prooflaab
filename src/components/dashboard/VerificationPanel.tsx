import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Brain, 
  Github, 
  GraduationCap, 
  Shield, 
  RefreshCw, 
  FileText,
  ExternalLink,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger 
} from "@/components/ui/tooltip";

interface VerificationPanelProps {
  // AI Verification
  aiAuthorshipRisk?: number | null;
  aiSummary?: string | null;
  
  // GitHub Verification
  commitCount?: number | null;
  commitAuthenticityScore?: number | null;
  repoUrl?: string | null;
  
  // Conceptual Test
  conceptualScore?: number | null;
  
  // Trust Score
  trustScore?: number | null;
  trustChange?: number | null;
  
  // Actions
  onReVerify?: () => void;
  onViewLogs?: () => void;
  isVerifying?: boolean;
}

const VerificationPanel = ({
  aiAuthorshipRisk,
  aiSummary,
  commitCount,
  commitAuthenticityScore,
  repoUrl,
  conceptualScore,
  trustScore,
  trustChange,
  onReVerify,
  onViewLogs,
  isVerifying = false
}: VerificationPanelProps) => {
  
  const getScoreColor = (score: number | null | undefined): string => {
    if (score === null || score === undefined) return "text-muted-foreground bg-muted";
    if (score >= 80) return "text-green-700 bg-green-100 border-green-300";
    if (score >= 60) return "text-orange-700 bg-orange-100 border-orange-300";
    return "text-red-700 bg-red-100 border-red-300";
  };

  const getScoreEmoji = (score: number | null | undefined): string => {
    if (score === null || score === undefined) return "⏳";
    if (score >= 80) return "✅";
    if (score >= 60) return "⚠️";
    return "❌";
  };

  // Convert AI authorship risk to originality score (100 - risk)
  const aiOriginalityScore = aiAuthorshipRisk !== null && aiAuthorshipRisk !== undefined 
    ? 100 - aiAuthorshipRisk 
    : null;

  const hasAnyData = aiOriginalityScore !== null || 
                     commitAuthenticityScore !== null || 
                     conceptualScore !== null || 
                     trustScore !== null;

  if (!hasAnyData) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No verification data available</p>
          {onReVerify && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onReVerify}
              disabled={isVerifying}
              className="mt-3"
            >
              <RefreshCw className={`h-3 w-3 mr-2 ${isVerifying ? 'animate-spin' : ''}`} />
              Run Full Verification
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Verification Results
          </h3>
          <div className="flex gap-2">
            {onViewLogs && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={onViewLogs}
                      className="h-7 px-2"
                    >
                      <FileText className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View Audit Logs</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {onReVerify && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={onReVerify}
                      disabled={isVerifying}
                      className="h-7 px-2"
                    >
                      <RefreshCw className={`h-3 w-3 ${isVerifying ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Re-run Verification</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* AI Authorship */}
          {aiOriginalityScore !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`p-3 rounded-lg border ${getScoreColor(aiOriginalityScore)}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Brain className="h-4 w-4" />
                      <span className="text-xs font-medium">AI Authorship</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{getScoreEmoji(aiOriginalityScore)}</span>
                      <span className="text-lg font-bold">{aiOriginalityScore}%</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-semibold mb-1">Originality Score</p>
                  <p className="text-xs">{aiSummary || "Measures human authorship vs AI-generated content"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* GitHub Commits */}
          {(commitAuthenticityScore !== null || commitCount !== null) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`p-3 rounded-lg border ${getScoreColor(commitAuthenticityScore)}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Github className="h-4 w-4" />
                      <span className="text-xs font-medium">GitHub Commits</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{getScoreEmoji(commitAuthenticityScore)}</span>
                      <span className="text-lg font-bold">{commitCount || 0}</span>
                    </div>
                    {repoUrl && (
                      <a 
                        href={repoUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs flex items-center gap-1 mt-1 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Repo <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-semibold mb-1">Commit Authenticity: {commitAuthenticityScore || "N/A"}</p>
                  <p className="text-xs">Analyzes commit patterns and distribution to verify genuine development work</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Concept Mastery */}
          {conceptualScore !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`p-3 rounded-lg border ${getScoreColor(conceptualScore)}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <GraduationCap className="h-4 w-4" />
                      <span className="text-xs font-medium">Concept Mastery</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{getScoreEmoji(conceptualScore)}</span>
                      <span className="text-lg font-bold">{conceptualScore}%</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-semibold mb-1">Understanding Score</p>
                  <p className="text-xs">Evaluates comprehension of core concepts through Q&A assessment</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Final Trust Score */}
          {trustScore !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`p-3 rounded-lg border ${getScoreColor(trustScore)}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="h-4 w-4" />
                      <span className="text-xs font-medium">Trust Score</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{getScoreEmoji(trustScore)}</span>
                      <span className="text-lg font-bold">{trustScore}%</span>
                    </div>
                    {trustChange !== null && trustChange !== undefined && trustChange !== 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        {trustChange > 0 ? (
                          <TrendingUp className="h-3 w-3 text-green-600" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-600" />
                        )}
                        <span className={`text-xs font-medium ${trustChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {trustChange > 0 ? '+' : ''}{trustChange}
                        </span>
                      </div>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-semibold mb-1">Cognitive Integrity Score</p>
                  <p className="text-xs">Composite score computed from all verification metrics (30% commit, 30% AI, 40% conceptual)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VerificationPanel;
