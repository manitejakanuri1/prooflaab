import {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  verifyBffEmail,
} from "@/integrations/google/bffSession";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

import {
  Loader2,
} from "lucide-react";

export default function AuthCallback() {
  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  useEffect(() => {
    let active = true;

    const complete =
      async () => {
        try {
          const code =
            searchParams.get(
              "oobCode",
            ) ??
            searchParams.get(
              "oob_code",
            );

          if (code) {
            await verifyBffEmail(
              code,
            );
          }

          // The pre-verification session may contain
          // an old confirmation flag. Revoke it so the
          // next login rebuilds identity from the server.
          await supabase.auth
            .signOut()
            .catch(
              () => undefined,
            );

          if (!active) {
            return;
          }

          navigate(
            code
              ? "/auth?message=Email confirmed! Please log in."
              : "/auth?message=Please sign in to continue.",
            {
              replace: true,
            },
          );
        } catch (
          callbackError
        ) {
          if (!active) {
            return;
          }

          setError(
            callbackError instanceof Error
              ? callbackError.message
              : "Authentication failed. Please try again.",
          );
        }
      };

    void complete();

    return () => {
      active = false;
    };
  }, [
    navigate,
    searchParams,
  ]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-destructive">
              Authentication Error
            </CardTitle>
          </CardHeader>

          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>
                {error}
              </AlertDescription>
            </Alert>

            <div className="mt-4 text-center">
              <a
                href="/auth"
                className="text-primary hover:underline"
              >
                Return to Login
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            Completing Authentication...
          </CardTitle>
        </CardHeader>

        <CardContent className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">
            Please wait while we complete your request...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
