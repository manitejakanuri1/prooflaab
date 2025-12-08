import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Award, PartyPopper, Briefcase, Package, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

interface PackCompletionCelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  packName: string;
  badgeName?: string | null;
  xpAwarded: number;
}

const PackCompletionCelebrationModal = ({
  isOpen,
  onClose,
  packName,
  badgeName,
  xpAwarded,
}: PackCompletionCelebrationModalProps) => {
  const navigate = useNavigate();
  const hasTriggeredConfetti = useRef(false);

  useEffect(() => {
    if (isOpen && !hasTriggeredConfetti.current) {
      hasTriggeredConfetti.current = true;
      
      // Fire confetti from both sides
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Left side confetti
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          colors: ['#ff6b35', '#f7931e', '#ffd700', '#22c55e', '#3b82f6', '#8b5cf6'],
        });

        // Right side confetti
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          colors: ['#ff6b35', '#f7931e', '#ffd700', '#22c55e', '#3b82f6', '#8b5cf6'],
        });
      }, 250);

      return () => clearInterval(interval);
    }
  }, [isOpen]);

  // Reset confetti trigger when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasTriggeredConfetti.current = false;
    }
  }, [isOpen]);

  const handleViewPortfolio = () => {
    onClose();
    navigate("/student/portfolio");
  };

  const handleBrowsePacks = () => {
    onClose();
    navigate("/student/task-packs");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-0 bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-orange-950/40 dark:via-amber-950/40 dark:to-yellow-950/40">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors z-10"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>

        {/* Header with celebration icon */}
        <div className="relative pt-8 pb-4 px-6 text-center">
          <div className="relative inline-flex">
            <div className="absolute inset-0 animate-ping bg-orange-400/30 rounded-full" />
            <div className="relative p-4 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 shadow-lg shadow-orange-500/30">
              <PartyPopper className="h-10 w-10 text-white" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 text-center space-y-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              🎉 Congratulations!
            </h2>
            <p className="text-muted-foreground">
              You completed the
            </p>
            <p className="text-lg font-semibold text-primary">
              {packName}
            </p>
          </div>

          {/* Badge Display */}
          <div className="flex justify-center py-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-orange-500/20 via-amber-500/20 to-yellow-500/20 rounded-full blur-xl animate-pulse" />
              <div className="relative p-6 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/50 dark:to-amber-900/50 border-2 border-orange-300 dark:border-orange-700 shadow-inner">
                <Award className="h-16 w-16 text-orange-500" />
              </div>
            </div>
          </div>

          {/* Rewards */}
          <div className="flex flex-wrap justify-center gap-3">
            {badgeName && (
              <Badge 
                variant="outline" 
                className="px-4 py-2 text-sm bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
              >
                <Award className="h-4 w-4 mr-2" />
                {badgeName}
              </Badge>
            )}
            <Badge 
              variant="outline" 
              className="px-4 py-2 text-sm bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
            >
              <span className="mr-1">⚡</span>
              +{xpAwarded} XP
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground pt-2">
            {badgeName 
              ? `You earned the "${badgeName}" badge and ${xpAwarded} XP!`
              : `You earned ${xpAwarded} XP for completing this pack!`
            }
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button 
              variant="outline"
              onClick={handleViewPortfolio}
              className="flex-1 gap-2"
            >
              <Briefcase className="h-4 w-4" />
              View Portfolio
            </Button>
            <Button 
              onClick={handleBrowsePacks}
              className="flex-1 gap-2 bg-orange-500 hover:bg-orange-600 text-white"
            >
              <Package className="h-4 w-4" />
              Browse More Packs
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PackCompletionCelebrationModal;
