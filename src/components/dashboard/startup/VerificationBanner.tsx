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
      <Alert className="border-alert bg-alert/10 mb-6">
        <XCircle className="h-5 w-5 text-alert" />
        <AlertTitle className="text-alert font-semibold">
          Account Verification Rejected
        </AlertTitle>
        <AlertDescription className="text-alert/90">
          Your startup account was not approved. Please contact our support team for more information.
          <div className="mt-3">
            <Button 
              variant="outline" 
              size="sm"
              className="border-alert text-alert hover:bg-alert hover:text-background"
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
    <Alert className="border-compete bg-compete/10 mb-6">
      <AlertTriangle className="h-5 w-5 text-compete" />
      <AlertTitle className="text-compete font-semibold">
        Account Verification Pending
      </AlertTitle>
      <AlertDescription className="text-compete">
        Your startup account is under review by the ProofLab team. You'll be able to post tasks and access student submissions once verification is complete.
        <div className="mt-3">
          <Button 
            variant="outline" 
            size="sm"
            className="border-compete text-compete hover:bg-compete hover:text-background"
            asChild
          >
            <a href="mailto:hello@prooflab.co.in">{/* MF-127: the real support address */}
              <Mail className="h-4 w-4 mr-2" />
              Contact Support
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
