import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Link } from "react-router-dom";

interface StickyCtaBarProps {
  activeTab: string;
}

const StickyCtaBar = ({ activeTab }: StickyCtaBarProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const location = useLocation();

  // Show CTA bar after scrolling
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 400;
      setIsVisible(scrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Hide on specific routes
  const hiddenRoutes = ['/pricing', '/dashboard', '/login', '/auth'];
  const shouldHide = hiddenRoutes.some(route => location.pathname.startsWith(route));

  // Reset dismissal when tab changes
  useEffect(() => {
    setIsDismissed(false);
  }, [activeTab]);

  // Don't render if dismissed, hidden route, not visible from scroll, or not on landing page
  if (isDismissed || shouldHide || !isVisible || location.pathname !== '/') {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  const getCtaContent = () => {
    switch (activeTab) {
      case 'students':
        return {
          text: "🚀 Want a verified internship experience?",
          buttons: [
            { text: "Student Sign In", href: "/auth", variant: "default" as const },
            { text: "See Student Plans", href: "/pricing#students", variant: "outline" as const }
          ]
        };
      case 'colleges':
        return {
          text: "🎓 Onboard your students to India's first AI-powered proof-of-work platform.",
          buttons: [
            { text: "College Sign In", href: "/auth", variant: "default" as const },
            { text: "See College Plans", href: "/pricing#colleges", variant: "outline" as const }
          ]
        };
      case 'startups':
        return {
          text: "💼 Want proof-driven interns for your startup? No fake certificates. Only real work.",
          buttons: [
            { text: "Company Sign In", href: "/auth", variant: "default" as const },
            { text: "See Startup Plans", href: "/pricing#startups", variant: "outline" as const }
          ]
        };
      default:
        return null;
    }
  };

  const content = getCtaContent();
  if (!content) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border shadow-lg dark:bg-card">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm md:text-base font-medium text-foreground truncate">
              {content.text}
            </p>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            {content.buttons.map((button, index) => (
              <Link key={index} to={button.href}>
                <Button
                  variant={button.variant}
                  size="sm"
                  className="text-xs md:text-sm whitespace-nowrap"
                >
                  {button.text}
                </Button>
              </Link>
            ))}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="p-1 h-8 w-8 flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StickyCtaBar;