import { Shield, CheckCircle2, XCircle, User, Brain } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IntegrityContextPanelProps {
  declarationAcknowledged?: boolean;
  declarationText?: string | null;
  reflectionRequested?: boolean;
  aiAuthorshipRisk?: number;
  conceptualScore?: number;
  trustScore?: number;
}

export const IntegrityContextPanel = ({
  declarationAcknowledged,
  declarationText,
  reflectionRequested,
  aiAuthorshipRisk,
  conceptualScore,
  trustScore,
}: IntegrityContextPanelProps) => {
  // Calculate ethical context label
  const getEthicalLabel = () => {
    const hasHelper = declarationText && declarationText.trim().length > 0;
    const highAI = (aiAuthorshipRisk || 0) > 50;
    const lowConceptual = (conceptualScore || 0) < 50;
    const highTrust = (trustScore || 0) >= 60;

    if (hasHelper && highTrust) {
      return { label: "Guided Learning", color: "bg-blue-500" };
    }
    if (!hasHelper && highTrust && !highAI) {
      return { label: "Independent Authorship", color: "bg-green-500" };
    }
    if (highAI && lowConceptual && !declarationAcknowledged) {
      return { label: "Proxy Risk", color: "bg-orange-500" };
    }
    return { label: "Standard Review", color: "bg-muted" };
  };

  const ethicalContext = getEthicalLabel();

  return (
    <Card className="p-4 space-y-4 bg-muted/30">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">Integrity Context</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge
                variant="secondary"
                className={`${ethicalContext.color} text-white ml-auto`}
              >
                {ethicalContext.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-[200px]">
                Ethical context based on student declaration and performance
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2">
          {declarationAcknowledged ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          )}
          <div>
            <p className="font-medium">Declaration</p>
            <p className="text-xs text-muted-foreground">
              {declarationAcknowledged
                ? "Student confirmed work authenticity"
                : "No declaration provided"}
            </p>
          </div>
        </div>

        {declarationText && (
          <div className="flex items-start gap-2 bg-background/50 rounded-md p-2">
            <User className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-xs">Declared Helper</p>
              <p className="text-xs text-muted-foreground">{declarationText}</p>
            </div>
          </div>
        )}

        {reflectionRequested && (
          <div className="flex items-start gap-2 bg-orange-500/10 rounded-md p-2 border border-orange-500/20">
            <Brain className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-xs text-orange-600 dark:text-orange-400">
                Reflection Requested
              </p>
              <p className="text-xs text-muted-foreground">
                Student requested mentor review
              </p>
            </div>
          </div>
        )}

        <div className="pt-2 border-t space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              AI Authorship Risk
            </span>
            <span className="text-xs font-medium">
              {aiAuthorshipRisk !== undefined
                ? `${Math.round(aiAuthorshipRisk)}%`
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              Conceptual Score
            </span>
            <span className="text-xs font-medium">
              {conceptualScore !== undefined
                ? `${Math.round(conceptualScore)}/100`
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Trust Score</span>
            <span className="text-xs font-medium">
              {trustScore !== undefined ? `${Math.round(trustScore)}/100` : "N/A"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};
