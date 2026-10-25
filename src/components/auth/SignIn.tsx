import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logAuthEvent, classifyAuthError } from "@/lib/securityLog";
import { signInProblem } from "@/lib/signInProblem";
import { Button } from "@/components/landing/LandingButton";
import {
  AccessHeading, BackButton, ErrorMessage, FieldLabel, NoticeMessage, PrimaryAction,
  inputClass, panelMotion, useCapsLock,
} from "./AccessShell";

// The sign-in card: Lovable's four steps (email, password, reset, verified) over our
// real sign-in. The sign-in, reset and role checks are the ones the old
// EnhancedRoleBasedAuthForm did, unchanged; only the look and the wording are new.
// Wording follows the UX copy rules: plain, no "failed"/"wrong"/"invalid".

type View = "email" | "password" | "reset" | "success";
type UserRole = "student" | "college_admin" | "startup" | "admin" | "recruiter";

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Clears auth keys left by older deployments before a fresh sign-in (the BFF session is HttpOnly). */
function cleanupAuthState() {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("supabase.auth.") || key.includes("sb-") || key.startsWith("prooflab.auth.")) localStorage.removeItem(key);
  });
}

export default function SignIn({ onSuccess, notice = "" }: { onSuccess: (role: UserRole) => void; notice?: string }) {
  const [view, setView] = useState<View>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const caps = useCapsLock();

  // Going back never wipes the email; it only clears the message on screen.
  const changeView = (next: View) => {
    setError("");
    setSent("");
    setView(next);
  };

  const goToPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!isEmail(email)) return setError("Enter a valid email address to continue.");
    setError("");
    setView("password");
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return setError("Enter your password to sign in.");
    setBusy(true);
    setError("");
    try {
      cleanupAuthState();
      await supabase.auth.signOut({ scope: "global" }).catch(() => {});
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        logAuthEvent("login_failed", email, classifyAuthError(error.message));
        throw error;
      }
      if (!data.user) return;
      logAuthEvent("login_succeeded", email);
      if (!data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        return setError("Confirm your email first. The link is in your inbox.");
      }
      const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
      // No role means the account was never set up here; guessing "student" sent colleges to student pages.
      if (!userRole?.role) {
        await supabase.auth.signOut();
        return setError("Your college or the Prooflab team manages access to this account.");
      }
      setView("success");
      // A short beat so the "ACCESS VERIFIED" tick is seen before the dashboard opens.
      const role = userRole.role;
      setTimeout(() => onSuccess(role), 800);
    } catch (err) {
      console.error("Auth error:", err);
      setError(signInProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!isEmail(email)) return setError("Enter the email linked to your Prooflab workspace.");
    setBusy(true);
    setError("");
    setSent("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
      logAuthEvent("password_reset_requested", email);
      setSent("If this email has a Prooflab account, a reset link is on its way. Check your inbox.");
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(signInProblem(err));
    } finally {
      setBusy(false);
    }
  };

  // A hidden copy of the email inside the password and reset forms, so password
  // managers save and fill the right account.
  const usernameField = (
    <input type="email" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
  );

  let panel;
  if (view === "email") {
    panel = (
      <motion.div key="email" {...panelMotion}>
        <AccessHeading title="Sign in to Prooflab" description="Enter your workspace email to begin." />
        {notice && <NoticeMessage message={notice} />}
        <form onSubmit={goToPassword} className="mt-10" noValidate>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <input id="login-email" name="username" type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
            spellCheck={false} autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email"
            aria-invalid={Boolean(error)} aria-describedby={error ? "login-email-error" : undefined} className={inputClass(error)} />
          <ErrorMessage id="login-email-error" message={error} />
          <PrimaryAction>CONTINUE <ArrowRight /></PrimaryAction>
        </form>
      </motion.div>
    );
  }

  else if (view === "password") {
    panel = (
      <motion.div key="password" {...panelMotion}>
        <BackButton onClick={() => changeView("email")} />
        <AccessHeading title="Welcome back." description={email} />
        <form onSubmit={signIn} className="mt-9" noValidate>
          {usernameField}
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <div className="relative">
            <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
              autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={caps.onKey} onKeyUp={caps.onKey}
              placeholder="Enter your password" aria-invalid={Boolean(error)} aria-describedby={error ? "login-password-error" : undefined}
              className={`${inputClass(error)} pr-12`} />
            <Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute bottom-2 right-2 text-muted-foreground hover:bg-surface hover:text-foreground">
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {caps.warning}
          <ErrorMessage id="login-password-error" message={error} />
          <button type="button" onClick={() => changeView("reset")}
            className="mt-4 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:text-primary">
            Forgot password?
          </button>
          <PrimaryAction busy={busy} busyLabel="SIGNING IN…">SIGN IN <ArrowRight /></PrimaryAction>
        </form>
      </motion.div>
    );
  }

  else if (view === "reset") {
    panel = (
      <motion.div key="reset" {...panelMotion}>
        <BackButton onClick={() => changeView("password")} />
        <AccessHeading title="Reset your access." description="We’ll prepare a secure reset link for your workspace email." />
        <form onSubmit={sendReset} className="mt-9" noValidate>
          <FieldLabel htmlFor="reset-email">Email</FieldLabel>
          <input id="reset-email" name="username" type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
            spellCheck={false} autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email"
            aria-invalid={Boolean(error)} aria-describedby={error ? "reset-email-error" : undefined} className={inputClass(error)} />
          <ErrorMessage id="reset-email-error" message={error} />
          <NoticeMessage message={sent} />
          <PrimaryAction busy={busy} busyLabel="SENDING…">SEND RESET LINK <ArrowRight /></PrimaryAction>
        </form>
      </motion.div>
    );
  }

  else panel = (
    <motion.div key="success" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
      className="flex min-h-[396px] flex-col items-center justify-center text-center" role="status">
      <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 180, damping: 17 }}
        className="relative flex size-28 items-center justify-center rounded-full border border-verified/50 bg-verified/10">
        <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1.35, opacity: 0 }} transition={{ duration: 1.5, repeat: Infinity }}
          className="absolute inset-0 rounded-full border border-verified/40" />
        <ShieldCheck className="size-11 text-verified" strokeWidth={1.5} />
        <span className="absolute bottom-2 right-1 flex size-7 items-center justify-center rounded-full bg-verified text-primary-foreground">
          <Check className="size-4" />
        </span>
      </motion.div>
      <p className="mono-label mt-8 text-verified">ACCESS VERIFIED</p>
      <h2 className="mt-4 font-display text-2xl font-semibold tracking-normal">Opening your workspace...</h2>
      <div className="mt-8 h-px w-40 overflow-hidden bg-border">
        <motion.div className="h-full bg-primary" initial={{ x: "-100%" }} animate={{ x: "100%" }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
      </div>
    </motion.div>
  );
  return <AnimatePresence mode="wait">{panel}</AnimatePresence>;
}
