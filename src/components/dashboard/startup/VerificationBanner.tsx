import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, XCircle, Mail } from "lucide-react";

interface VerificationBannerProps {
  verificationStatus: string;
}

export function VerificationBanner({ verificationStatus }: VerificationBannerProps) {
  if (verificationStatus === "approved") {
    return null; // Don't show banner if approved
  }

  if (verificationStatus === "rejected") {
    return (
      <Alert className="border-destructive bg-destructive/10 mb-6">
        <XCircle className="h-5 w-5 text-destructive" />
        <AlertTitle className="text-destructive font-semibold">
          Account Verification Rejected
        </AlertTitle>
        <AlertDescription className="text-destructive/90">
          Your startup account was not approved. Please contact our support team for more information.
          <div className="mt-3">
            <Button 
              variant="outline" 
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              asChild
            >
              <a href="mailto:hello@prooflab.co.in">
                <Mail className="h-4 w-4 mr-2" />
                Contact Support
              </a>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Default: pending status
  return (
    <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20 mb-6">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
      <AlertTitle className="text-amber-900 dark:text-amber-100 font-semibold">
        Account Verification Pending
      </AlertTitle>
      <AlertDescription className="text-amber-800 dark:text-amber-200">
        Your startup account is under review by the ProofLabAI team. You'll be able to post tasks and access student submissions once verification is complete.
        <div className="mt-3">
          <Button 
            variant="outline" 
            size="sm"
            className="border-amber-600 text-amber-700 hover:bg-amber-600 hover:text-white dark:border-amber-500 dark:text-amber-400"
            asChild
          >
            <a href="mailto:support@prooflabai.com">
              <Mail className="h-4 w-4 mr-2" />
              Contact Support
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
