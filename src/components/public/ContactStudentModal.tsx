import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Mail, 
  Linkedin, 
  Github, 
  FileText, 
  ExternalLink, 
  Trophy, 
  Shield,
  X
} from "lucide-react";
import { Link } from "react-router-dom";

interface StudentInfo {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  branch: string | null;
  total_xp: number | null;
  trust_score: number | null;
  email: string | null;
  slug: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  resume_url?: string | null;
}

interface ContactStudentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: StudentInfo | null;
  postTitle?: string;
  onEmailClick?: () => void;
  onLinkedinClick?: () => void;
  onGithubClick?: () => void;
  onResumeClick?: () => void;
}

export const ContactStudentModal = ({
  open,
  onOpenChange,
  student,
  postTitle,
  onEmailClick,
  onLinkedinClick,
  onGithubClick,
  onResumeClick,
}: ContactStudentModalProps) => {
  if (!student) return null;

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (score >= 60) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  };

  const emailSubject = postTitle 
    ? `Regarding your project: ${postTitle}`
    : `Interest in your ProofLabAI profile`;

  const hasContactOptions = student.email || student.linkedin_url || student.github_url || student.resume_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-background/50 transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
          <DialogTitle className="text-lg font-semibold">Contact Student</DialogTitle>
        </DialogHeader>

        {/* Student Info */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-primary/20">
              <AvatarImage src={student.profile_photo_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                {getInitials(student.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg text-foreground truncate">
                {student.full_name}
              </h3>
              {student.branch && (
                <p className="text-sm text-muted-foreground">{student.branch}</p>
              )}
            </div>
          </div>

          {/* Stats Badges */}
          <div className="flex flex-wrap gap-2 mt-4">
            {student.total_xp !== null && student.total_xp > 0 && (
              <Badge variant="secondary" className="gap-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                <Trophy className="h-3.5 w-3.5" />
                {student.total_xp} XP
              </Badge>
            )}
            {student.trust_score !== null && student.trust_score > 0 && (
              <Badge 
                variant="secondary" 
                className={`gap-1.5 border-0 ${getTrustScoreColor(student.trust_score)}`}
              >
                <Shield className="h-3.5 w-3.5" />
                {student.trust_score}% Trust
              </Badge>
            )}
          </div>
        </div>

        {/* Contact Actions */}
        <div className="px-6 pb-6 space-y-3">
          {hasContactOptions ? (
            <>
              {student.email && (
                <a
                  href={`mailto:${student.email}?subject=${encodeURIComponent(emailSubject)}`}
                  onClick={onEmailClick}
                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                >
                  <Mail className="h-5 w-5" />
                  <span className="flex-1">Send Email</span>
                  <ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              )}

              {student.linkedin_url && (
                <a
                  href={student.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onLinkedinClick}
                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-[#0A66C2] text-white hover:bg-[#0A66C2]/90 transition-colors font-medium"
                >
                  <Linkedin className="h-5 w-5" />
                  <span className="flex-1">View LinkedIn</span>
                  <ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              )}

              {student.github_url && (
                <a
                  href={student.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onGithubClick}
                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-[#24292e] text-white hover:bg-[#24292e]/90 transition-colors font-medium"
                >
                  <Github className="h-5 w-5" />
                  <span className="flex-1">View GitHub</span>
                  <ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              )}

              {student.resume_url && (
                <a
                  href={student.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onResumeClick}
                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-muted hover:bg-muted/80 text-foreground transition-colors font-medium border border-border"
                >
                  <FileText className="h-5 w-5" />
                  <span className="flex-1">Download Resume</span>
                  <ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              )}
            </>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No contact information available
            </div>
          )}

          {/* View Full Portfolio */}
          {student.slug && (
            <Link
              to={`/portfolio/${student.slug}`}
              className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors font-medium text-foreground mt-4"
            >
              View Full Portfolio
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
