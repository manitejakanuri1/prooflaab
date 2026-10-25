import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/landing/LandingButton";
import { Logo, Wordmark } from "@/components/Logo";
import "@/components/landing/landing.css";
import { BrandScope } from "@/lib/brandScope";

// The frame of the sign-in and set-password pages: prooflab-ai.lovable.app's /login
// design (owner decision 25 Oct 2026). Always dark, like Lovable's. Only the look is
// Lovable's; what the forms do is ours.

/** Sets the browser tab title while the page is open. */
export function usePageTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [title]);
}

/** The dark brand page: grid, glow and logo. Shadcn parts inside pick up the
 * brand colours on their own, since .pl-landing redefines the colour variables. */
export function BrandFrame({ children, className = "max-w-[460px]", logoHome = true }: { children: ReactNode; className?: string; logoHome?: boolean }) {
  const logo = (
    <span className="inline-flex scale-125 items-center gap-1 sm:scale-[1.4]">
      <Logo className="h-6" alt="" />
      <Wordmark />
    </span>
  );
  return (
    // reducedMotion="user": phones set to "reduce motion" get no animation.
    <MotionConfig reducedMotion="user">
      <BrandScope.Provider value="pl-landing dark">
      <main className="pl-landing dark relative min-h-[100svh] overflow-x-hidden bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-35" />
        <div className="pointer-events-none absolute -top-48 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[150px]" />
        <section className="relative flex min-h-[100svh] items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
          <div className={`w-full ${className}`}>
            {logoHome ? (
              <Link to="/" aria-label="Return to Prooflab home" className="mx-auto mb-8 flex w-fit justify-center sm:mb-10">{logo}</Link>
            ) : (
              <div className="mx-auto mb-8 flex w-fit justify-center sm:mb-10">{logo}</div>
            )}
            {children}
          </div>
        </section>
      </main>
      </BrandScope.Provider>
    </MotionConfig>
  );
}

/** The card with the thin blue line on top. */
export const brandCard = "relative overflow-hidden rounded-lg border border-border bg-card/80 p-6 shadow-[0_28px_100px_-40px_hsl(var(--primary)/0.45)] backdrop-blur-xl sm:p-9";

export function AccessShell({ children }: { children: ReactNode }) {
  return (
    <BrandFrame>
      <div className="mb-5 flex items-center justify-between">
        <span className="mono-label text-primary">PROOFLAB ACCESS</span>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase text-verified">
          <span className="size-1.5 rounded-full bg-verified" /> Secure entry
        </span>
      </div>
      <div className={`${brandCard} min-h-[430px] sm:min-h-[470px]`}>
        <div className="absolute left-0 top-0 h-px w-1/3 bg-primary" />
        {children}
      </div>
    </BrandFrame>
  );
}

export const panelMotion = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -14 },
  transition: { duration: 0.28 },
};

export function AccessHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-normal sm:text-4xl">{title}</h1>
      {description && <p className="mt-4 break-words text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return <label htmlFor={htmlFor} className="mono-label text-foreground/70">{children}</label>;
}

// text-base below sm: phones zoom into any box with text under 16px.
export function inputClass(error: string) {
  return `mt-3 h-[3.25rem] w-full rounded-md border bg-surface/70 px-4 text-base sm:text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/20 ${
    error ? "border-alert focus:border-alert" : "border-input focus:border-primary/70"
  }`;
}

/** Red line under a box. role="alert" so screen readers read it out. */
export function ErrorMessage({ id, message }: { id: string; message: string }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p id={id} role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="mt-3 text-xs leading-relaxed text-alert">
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Blue-green line for good news (reset link sent, password set). */
export function NoticeMessage({ message }: { message: string }) {
  return message ? <p role="status" className="mt-3 text-xs leading-relaxed text-verified">{message}</p> : null;
}

/** The big blue button. Shows a spinner and its busy label, and cannot be pressed twice. */
export function PrimaryAction({ busy, busyLabel, disabled, children }: { busy?: boolean; busyLabel?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={busy || disabled} aria-busy={busy} className="mt-6 h-[3.25rem] w-full font-mono text-[11px] tracking-[0.14em]">
      {busy ? <><Loader2 className="animate-spin" /> {busyLabel}</> : children}
    </Button>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}
      className="-ml-3 mb-7 font-mono text-[9px] uppercase text-muted-foreground hover:bg-surface hover:text-foreground">
      <ArrowLeft /> Back
    </Button>
  );
}

/** "Caps Lock is on" under a password box. Wire `onKey` to the box's onKeyDown and onKeyUp. */
export function useCapsLock() {
  const [on, setOn] = useState(false);
  const onKey = (event: KeyboardEvent) => setOn(event.getModifierState?.("CapsLock") ?? false);
  const warning = on ? <p className="mt-2 font-mono text-[10px] uppercase text-compete">Caps Lock is on</p> : null;
  return { onKey, warning };
}
