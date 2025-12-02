import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/Logo";
import { ArrowLeft, LogIn, Briefcase } from "lucide-react";

interface RecruiterHeaderProps {
  isLoggedIn: boolean;
  isStudent: boolean;
  isLoading?: boolean;
}

export const RecruiterHeader = ({ isLoggedIn, isStudent, isLoading }: RecruiterHeaderProps) => {
  // Recruiter mode: not logged in OR logged in but not a student
  const isRecruiterMode = !isStudent && !isLoading;

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border px-4 md:px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Left: Logo */}
        <Link to="/" className="font-bold text-lg flex items-center space-x-3 hover:opacity-80 transition-opacity">
          <Logo />
          <span className="hidden sm:inline">ProofLabAI</span>
        </Link>

        {/* Right: Mode-specific actions */}
        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="h-9 w-24 bg-muted animate-pulse rounded-md" />
          ) : isRecruiterMode ? (
            <>
              {/* Recruiter Mode Badge */}
              <Badge 
                variant="secondary" 
                className="hidden sm:flex items-center gap-1.5 bg-primary/10 text-primary border-primary/20"
              >
                <Briefcase className="h-3.5 w-3.5" />
                Recruiter Mode
              </Badge>
              
              {/* Sign In Button */}
              <Button asChild variant="outline" size="sm">
                <Link to="/auth" className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign In as Student</span>
                  <span className="sm:hidden">Sign In</span>
                </Link>
              </Button>
            </>
          ) : (
            /* Student Mode - Back to Dashboard */
            <Button asChild variant="outline" size="sm">
              <Link to="/student/dashboard" className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back to Dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
