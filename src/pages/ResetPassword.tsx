import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { completeBffPasswordReset, verifyBffPasswordReset } from "@/integrations/google/bffSession";
import { isPasswordValid } from "@/components/auth/PasswordInput";
import { Button } from "@/components/landing/LandingButton";
import {
  AccessHeading, AccessShell, ErrorMessage, FieldLabel, PrimaryAction, inputClass, panelMotion, useCapsLock, usePageTitle,
} from "@/components/auth/AccessShell";

// Set / reset password (the link in the email). Same frame as sign-in (Lovable's design,
// owner decision 25 Oct 2026). The link check and the save are unchanged; new are the
// live rule ticks, the "passwords match" line and the done screen with a Sign in button.

const LINK_PROBLEM = "This link has expired or was already used. Ask for a new one with Forgot password on the sign-in page.";

// The same five checks isPasswordValid scores (any three make a valid password).
const RULES: [string, (p: string) => boolean][] = [
  ["8 or more characters", (p) => p.length >= 8],
  ["A capital letter (A–Z)", (p) => /[A-Z]/.test(p)],
  ["A small letter (a–z)", (p) => /[a-z]/.test(p)],
  ["A number (0–9)", (p) => /\d/.test(p)],
  ["A symbol (! @ # $ …)", (p) => /[!@#$%^&*(),.?":{}|<>]/.test(p)],
];

function Tick({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-2 text-xs ${ok ? "text-verified" : "text-muted-foreground"}`}>
      <Check className={`size-3.5 ${ok ? "" : "opacity-30"}`} aria-hidden="true" />
      {children}
      <span className="sr-only">{ok ? "(done)" : "(not yet)"}</span>
    </li>
  );
}

export default function ResetPassword() {
  usePageTitle("Set your password · Prooflab");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("oobCode") ?? searchParams.get("oob_code");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const caps = useCapsLock();

  useEffect(() => {
    let active = true;
    // Every email link from the login service opens this page; "confirm your email"
    // links belong to /auth/callback.
    if (searchParams.get("mode") === "verifyEmail") {
      navigate(`/auth/callback?${searchParams}`, { replace: true });
      return;
    }
    (async () => {
      if (!code) {
        setChecking(false);
        setError(LINK_PROBLEM);
        return;
      }
      try {
        await verifyBffPasswordReset(code);
        if (active) setLinkValid(true);
      } catch {
        if (active) setError(LINK_PROBLEM);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => { active = false; };
  }, [code]);

  const valid = isPasswordValid(password);
  const matches = Boolean(confirm) && password === confirm;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!code || !linkValid) return setError(LINK_PROBLEM);
    if (!valid) return setError("Tick at least 3 of the boxes above to make the password strong enough.");
    if (!matches) return setError("The two passwords are not the same yet.");
    setBusy(true);
    setError("");
    try {
      await completeBffPasswordReset(code, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Your new password did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const goSignIn = () => navigate("/auth", { state: { message: "Password set. Sign in with your new password." } });

  let panel;
  if (checking) {
    panel = (
      <motion.div key="checking" {...panelMotion} className="flex min-h-[396px] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" /> Checking your link…
      </motion.div>
    );
  } else if (done) {
    panel = (
      <motion.div key="done" {...panelMotion} className="flex min-h-[396px] flex-col items-center justify-center text-center" role="status">
        <span className="flex size-20 items-center justify-center rounded-full border border-verified/50 bg-verified/10">
          <Check className="size-9 text-verified" />
        </span>
        <p className="mono-label mt-8 text-verified">PASSWORD SET</p>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-normal">You can sign in now.</h1>
        <Button onClick={goSignIn} autoFocus className="mt-8 h-[3.25rem] w-full font-mono text-[11px] tracking-[0.14em]">
          SIGN IN <ArrowRight />
        </Button>
      </motion.div>
    );
  } else if (!linkValid) {
    panel = (
      <motion.div key="bad-link" {...panelMotion}>
        <AccessHeading title="Set your password." />
        <ErrorMessage id="link-error" message={error} />
        <Button asChild className="mt-8 h-[3.25rem] w-full font-mono text-[11px] tracking-[0.14em]">
          <Link to="/auth">GO TO SIGN IN <ArrowRight /></Link>
        </Button>
      </motion.div>
    );
  } else {
    panel = (
      <motion.div key="form" {...panelMotion}>
        <AccessHeading title="Set your password." description="Choose a new password for your Prooflab account." />
        <form onSubmit={save} className="mt-8" noValidate>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <div className="relative">
            <input id="new-password" name="new-password" type={show ? "text" : "password"} autoComplete="new-password" autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={caps.onKey} onKeyUp={caps.onKey}
              placeholder="Enter a new password" aria-describedby="password-rules" className={`${inputClass("")} pr-12`} />
            <Button type="button" variant="ghost" size="icon" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute bottom-2 right-2 text-muted-foreground hover:bg-surface hover:text-foreground">
              {show ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {caps.warning}
          <p className="mt-4 text-xs text-muted-foreground">Use at least 3 of these:</p>
          <ul id="password-rules" className="mt-2 space-y-1.5">
            {RULES.map(([label, test]) => <Tick key={label} ok={test(password)}>{label}</Tick>)}
          </ul>

          <div className="mt-6">
            <FieldLabel htmlFor="confirm-password">Type it again</FieldLabel>
            <input id="confirm-password" name="confirm-password" type={show ? "text" : "password"} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={caps.onKey} onKeyUp={caps.onKey}
              placeholder="Enter it once more" className={inputClass("")} />
            {confirm && (
              <p className={`mt-2 text-xs ${matches ? "text-verified" : "text-muted-foreground"}`} role="status">
                {matches ? "✓ Passwords match" : "Not the same yet"}
              </p>
            )}
          </div>
          <ErrorMessage id="save-error" message={error} />
          <PrimaryAction busy={busy} busyLabel="SAVING…" disabled={!valid || !matches}>SAVE PASSWORD <ArrowRight /></PrimaryAction>
        </form>
      </motion.div>
    );
  }

  return (
    <AccessShell>
      <AnimatePresence mode="wait">{panel}</AnimatePresence>
    </AccessShell>
  );
}
