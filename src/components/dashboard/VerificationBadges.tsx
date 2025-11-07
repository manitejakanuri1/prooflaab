import { Badge } from "@/components/ui/badge";
import { Brain, Github, GraduationCap, ShieldCheck } from "lucide-react";

interface VerificationBadgesProps {
  aiAuthorshipScore?: number | null;
  commitAuthenticityScore?: number | null;
  conceptualScore?: number | null;
  cognitiveIntegrityScore?: number | null;
  size?: "sm" | "md" | "lg";
}

export function VerificationBadges({
  aiAuthorshipScore,
  commitAuthenticityScore,
  conceptualScore,
  cognitiveIntegrityScore,
  size = "md"
}: VerificationBadgesProps) {
  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return "bg-muted text-muted-foreground";
    if (score >= 75) return "bg-green-100 text-green-800 border-green-300";
    if (score >= 50) return "bg-orange-100 text-orange-800 border-orange-300";
    return "bg-red-100 text-red-800 border-red-300";
  };

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5"
  };

  const iconSize = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5"
  };

  return (
    <div className="flex flex-wrap gap-2">
      {/* Cognitive Integrity Score - Overall */}
      {cognitiveIntegrityScore !== null && cognitiveIntegrityScore !== undefined && (
        <Badge className={`${getScoreColor(cognitiveIntegrityScore)} border ${sizeClasses[size]} flex items-center gap-1.5`}>
          <ShieldCheck className={iconSize[size]} />
          <span className="font-medium">Integrity: {cognitiveIntegrityScore}</span>
        </Badge>
      )}

      {/* Authorship Integrity (AI Score) */}
      {aiAuthorshipScore !== null && aiAuthorshipScore !== undefined && (
        <Badge className={`${getScoreColor(aiAuthorshipScore)} border ${sizeClasses[size]} flex items-center gap-1.5`}>
          <Brain className={iconSize[size]} />
          <span className="font-medium">Authorship: {aiAuthorshipScore}</span>
        </Badge>
      )}

      {/* Commit Authenticity (GitHub Score) */}
      {commitAuthenticityScore !== null && commitAuthenticityScore !== undefined && (
        <Badge className={`${getScoreColor(commitAuthenticityScore)} border ${sizeClasses[size]} flex items-center gap-1.5`}>
          <Github className={iconSize[size]} />
          <span className="font-medium">Commits: {commitAuthenticityScore}</span>
        </Badge>
      )}

      {/* Concept Mastery (Conceptual Understanding) */}
      {conceptualScore !== null && conceptualScore !== undefined && (
        <Badge className={`${getScoreColor(conceptualScore)} border ${sizeClasses[size]} flex items-center gap-1.5`}>
          <GraduationCap className={iconSize[size]} />
          <span className="font-medium">Concepts: {conceptualScore}</span>
        </Badge>
      )}
    </div>
  );
}
