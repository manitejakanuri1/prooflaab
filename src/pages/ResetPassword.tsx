import React, {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  completeBffPasswordReset,
  verifyBffPasswordReset,
} from "@/integrations/google/bffSession";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Button,
} from "@/components/ui/button";

import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

import {
  Loader2,
} from "lucide-react";

import PasswordInput, {
  isPasswordValid,
} from "@/components/auth/PasswordInput";

export default function ResetPassword() {
  const [
    password,
    setPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    checkingLink,
    setCheckingLink,
  ] = useState(true);

  const [
    linkValid,
    setLinkValid,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const [
    message,
    setMessage,
  ] = useState<string | null>(
    null,
  );

  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const code =
    searchParams.get("oobCode") ??
    searchParams.get("oob_code");

  useEffect(() => {
    let active = true;

    const verify = async () => {
      if (!code) {
        if (active) {
          setCheckingLink(false);
          setLinkValid(false);
          setError(
            "Invalid reset link. Please request a new password reset.",
          );
        }
        return;
      }

      try {
        await verifyBffPasswordReset(
          code,
        );

        if (active) {
          setLinkValid(true);
          setError(null);
        }
      } catch (verifyError) {
        if (active) {
          setLinkValid(false);
          setError(
            verifyError instanceof Error
              ? verifyError.message
              : "Invalid reset link. Please request a new password reset.",
          );
        }
      } finally {
        if (active) {
          setCheckingLink(false);
        }
      }
    };

    void verify();

    return () => {
      active = false;
    };
  }, [code]);

  const handleSubmit =
    async (
      event:
        React.FormEvent,
    ) => {
      event.preventDefault();

      setError(null);
      setMessage(null);

      if (!code || !linkValid) {
        setError(
          "Invalid reset link. Please request a new password reset.",
        );
        return;
      }

      if (
        !isPasswordValid(
          password,
        )
      ) {
        setError(
          "Password is too weak. Please choose a stronger password.",
        );
        return;
      }

      if (
        password !==
        confirmPassword
      ) {
        setError(
          "Passwords do not match.",
        );
        return;
      }

      setLoading(true);

      try {
        await completeBffPasswordReset(
          code,
          password,
        );

        setMessage(
          "Password updated successfully! Redirecting to login...",
        );

        setTimeout(() => {
          navigate(
            "/auth",
            {
              state: {
                message:
                  "Password updated successfully! You can now log in with your new password.",
              },
            },
          );
        }, 2000);
      } catch (
        resetError
      ) {
        setError(
          resetError instanceof Error
            ? resetError.message
            : "Failed to update password. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            Reset Password
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {checkingLink ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Checking reset link...
              </span>
            </div>
          ) : (
            <form
              onSubmit={
                handleSubmit
              }
              className="space-y-4"
            >
              <PasswordInput
                value={password}
                onChange={
                  setPassword
                }
                placeholder="New Password"
                required
                showStrengthMeter
              />

              <PasswordInput
                value={
                  confirmPassword
                }
                onChange={
                  setConfirmPassword
                }
                placeholder="Confirm New Password"
                required
              />

              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading ||
                  !linkValid ||
                  !isPasswordValid(
                    password,
                  ) ||
                  password !==
                    confirmPassword
                }
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}

                Update Password
              </Button>

              {password &&
                !isPasswordValid(
                  password,
                ) && (
                  <p className="text-sm text-destructive text-center">
                    Password too weak
                  </p>
                )}

              {password &&
                confirmPassword &&
                password !==
                  confirmPassword && (
                  <p className="text-sm text-destructive text-center">
                    Passwords do not match
                  </p>
                )}
            </form>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
              </AlertDescription>
            </Alert>
          )}

          {message && (
            <Alert>
              <AlertDescription>
                {message}
              </AlertDescription>
            </Alert>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={() =>
                navigate(
                  "/auth",
                )
              }
              className="text-sm text-primary hover:underline"
            >
              Back to Login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
