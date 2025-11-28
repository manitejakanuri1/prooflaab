import { Calendar, ArrowRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "react-router-dom";

interface PublicProjectCardProps {
  emojiCode: string;
  title: string;
  description: string;
  skills: string[];
  submittedAt: string;
  fileUrl: string | null;
  proofId: string;
  postId?: string | null;
  aiSummary?: string | null;
  reflectionSummary?: string | null;
}

export const PublicProjectCard = ({
  emojiCode,
  title,
  description,
  skills,
  submittedAt,
  fileUrl,
  proofId,
  postId,
  aiSummary,
  reflectionSummary,
}: PublicProjectCardProps) => {
  const getEmoji = (code: string) => {
    try {
      return String.fromCodePoint(parseInt(code, 16));
    } catch {
      return "📦";
    }
  };

  // Use best available description
  const displayDescription = 
    aiSummary || 
    reflectionSummary || 
    description || 
    "A verified project completed through ProofLabAI.";

  return (
    <article className="relative bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-all hover:scale-[1.02] duration-200">
      {/* Verified Badge */}
      <div className="absolute top-4 right-4 z-10">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            Verified
          </span>
        </div>
      </div>

      {/* Emoji Icon */}
      <div className="mb-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-xl shadow-sm">
          <span className="text-4xl">{getEmoji(emojiCode)}</span>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl font-bold text-foreground mb-3 line-clamp-2">
        {title}
      </h3>

      {/* Description */}
      <p className="text-muted-foreground text-sm mb-4 line-clamp-3">
        {displayDescription}
      </p>

      {/* Skills */}
      {skills && skills.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {skills.slice(0, 4).map((skill, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="rounded-full text-xs"
            >
              {skill}
            </Badge>
          ))}
          {skills.length > 4 && (
            <Badge variant="secondary" className="rounded-full text-xs">
              +{skills.length - 4} more
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>{format(new Date(submittedAt), "MMM dd, yyyy")}</span>
        </div>

        {postId ? (
          <Link
            to={`/post/${postId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
          >
            <span>View Project</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : fileUrl ? (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
          >
            <span>View Project</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        ) : null}
      </div>
    </article>
  );
};
