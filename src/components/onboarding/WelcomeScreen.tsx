import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface WelcomeScreenProps {
  onStart: () => void;
  starting?: boolean;
}

/**
 * 1.1 Welcome — shown once, immediately after email confirmation.
 *
 * Blocking and full screen by design: there is no dismiss, no nav, no escape
 * hatch. The only way out is [Start].
 */
const WelcomeScreen = ({ onStart, starting = false }: WelcomeScreenProps) => {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="min-h-full flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-10">
            You&rsquo;re on the floor.
          </h1>

          <div className="space-y-6 text-base sm:text-lg leading-relaxed text-muted-foreground">
            <p>
              ProofLab doesn&rsquo;t offer any course. There are no video lectures here.
            </p>

            <p>
              Every day you get one real task, built from a real job posting or interview page.
              The source is shown on the task. You solve it,
              you explain it out loud for sixty seconds, and it goes into your build-log
              &mdash; a permanent public record of what you can actually do.
            </p>

            <p className="text-foreground font-medium">
              Recruiters read the build-log. Nobody reads a certificate.
            </p>

            <p>
              First, we need to know what to send you. That takes about five minutes.
            </p>
          </div>

          <div className="mt-12">
            <Button
              size="lg"
              onClick={onStart}
              disabled={starting}
              className="min-w-40 text-base"
            >
              {starting ? "Starting…" : "Start"}
              {!starting && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
