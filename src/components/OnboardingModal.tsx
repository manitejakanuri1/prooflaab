import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, School, Rocket, Target, Brain, Star, Inbox, Search, Trophy, Briefcase, Zap, Handshake } from "lucide-react";

interface OnboardingModalProps {
  user: any;
  onComplete: () => void;
}

const OnboardingModal = ({ user, onComplete }: OnboardingModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [userType, setUserType] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;

    const checkOnboardingStatus = async () => {
      try {
        // Check if user has been onboarded from metadata
        const hasBeenOnboarded = user.user_metadata?.onboarded;
        
        if (hasBeenOnboarded) {
          setIsLoading(false);
          return;
        }

        // maybeSingle, not single: a student who has just signed up has no
        // profile row yet, and PostgREST answers single() with 406 when the
        // count is not exactly one. That fired on every page for every new
        // account, because this modal is mounted globally in AuthContext.
        const { data: studentProfile } = await supabase
          .from('student_profiles')
          .select('id, profile_completed')
          .eq('user_id', user.id)
          .maybeSingle();

        if (studentProfile) {
          // Students are deliberately left alone. Their onboarding lives in
          // StudentStart now — welcome, then resume or skip, then the
          // assessment — and this modal opening on top of it is the "old
          // wizard keeps coming back" problem: it triggers on
          // profile_completed being false, which is exactly the state a
          // student is in from signup until they finish the new flow.
          setIsLoading(false);
          return;
        } else {
          // Check user metadata for other types
          const metaUserType = user.user_metadata?.user_type;
          if (metaUserType && ['college', 'startup'].includes(metaUserType)) {
            setUserType(metaUserType);
            setIsOpen(true);
          }
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkOnboardingStatus();
  }, [user]);

  const handleComplete = async (redirectPath?: string) => {
    try {
      // Update user metadata to mark as onboarded
      const { error } = await supabase.auth.updateUser({
        data: { onboarded: true }
      });

      if (error) throw error;

      // Send onboarding email
      try {
        const { error: emailError } = await supabase.functions.invoke('send-onboarding-email', {
          body: {
            userType: userType,
            email: user.email,
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'
          }
        });

        if (emailError) {
          console.error('Error sending onboarding email:', emailError);
          // Don't block the flow if email fails
        }
      } catch (emailError) {
        console.error('Failed to send onboarding email:', emailError);
        // Don't block the flow if email fails
      }

      setIsOpen(false);
      onComplete();

      if (redirectPath) {
        navigate(redirectPath);
      }

      toast({
        title: "Welcome aboard! 🎉",
        description: "Your onboarding is complete. Let's get started!",
      });
    } catch (error) {
      console.error('Error updating onboarding status:', error);
      toast({
        title: "Error",
        description: "Failed to complete onboarding. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getOnboardingContent = () => {
    switch (userType) {
      case 'student':
        return {
          icon: <GraduationCap className="h-16 w-16 text-primary" />,
          title: "Welcome to ProofLabAI!",
          subtitle: "Start building your verified portfolio",
          benefits: [
            { icon: <Target className="h-5 w-5 text-primary" />, text: "Get real internship tasks" },
            { icon: <Brain className="h-5 w-5 text-primary" />, text: "Build skill-based proof of work" },
            { icon: <Star className="h-5 w-5 text-primary" />, text: "Earn XP, badges, and a trusted portfolio" }
          ],
          ctaText: "Start My First Task",
          ctaAction: () => handleComplete('/dashboard/student/tasks')
        };
      case 'college':
        return {
          icon: <School className="h-16 w-16 text-primary" />,
          title: "Welcome, Campus Partner!",
          subtitle: "Manage and track student internships",
          benefits: [
            { icon: <Inbox className="h-5 w-5 text-primary" />, text: "Upload student list instantly" },
            { icon: <Search className="h-5 w-5 text-primary" />, text: "Track internship & proof progress" },
            { icon: <Trophy className="h-5 w-5 text-primary" />, text: "Boost your college trust score" }
          ],
          ctaText: "Upload Students",
          ctaAction: () => handleComplete('/dashboard/college/students')
        };
      case 'startup':
        return {
          icon: <Rocket className="h-16 w-16 text-primary" />,
          title: "Welcome to ProofLab for Startups!",
          subtitle: "Find and hire verified intern talent",
          benefits: [
            { icon: <Briefcase className="h-5 w-5 text-primary" />, text: "Post skill-based intern tasks" },
            { icon: <Zap className="h-5 w-5 text-primary" />, text: "Review actual proof of work" },
            { icon: <Handshake className="h-5 w-5 text-primary" />, text: "Build long-term intern pipelines" }
          ],
          ctaText: "Post Internship Task",
          ctaAction: () => handleComplete('/dashboard/startup/tasks')
        };
      default:
        return null;
    }
  };

  if (isLoading || !userType) {
    return null;
  }

  const content = getOnboardingContent();
  if (!content) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleComplete()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="relative bg-gradient-to-br from-primary/5 to-primary/10 p-8 md:p-12">
          {/* Hero Section */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              {content.icon}
            </div>
            
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
              {content.title}
            </h1>
            <p className="text-lg text-muted-foreground">
              {content.subtitle}
            </p>
          </div>

          {/* Benefits Section */}
          <div className="space-y-4 mb-8">
            {content.benefits.map((benefit, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-background/50 rounded-lg">
                {benefit.icon}
                <span className="text-foreground font-medium">{benefit.text}</span>
              </div>
            ))}
          </div>

          {/* CTA Section */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={content.ctaAction}
              size="lg"
              className="flex-1 sm:flex-none px-8"
            >
              {content.ctaText}
            </Button>
            <Button
              onClick={() => handleComplete()}
              variant="outline"
              size="lg"
              className="flex-1 sm:flex-none px-8"
            >
              Maybe Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingModal;