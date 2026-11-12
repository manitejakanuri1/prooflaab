import { useEffect, useState } from "react";

const RELOAD_KEY = "pl-auto-reload-at";
const SLOW_MS = 12_000;

/**
 * Owner E2E 12 Nov R7: a first sign-in sat on a bare spinner until the page was reloaded by hand.
 * Every full-page wait now says what it is doing, and if it is still waiting after 12 s it reloads
 * the page once by itself (a reload is what fixed it). At most one automatic reload a minute, so a
 * page that is really down shows a Reload button instead of reloading in a loop.
 */
export default function LoadingScreen({ className = "min-h-screen" }: { className?: string }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSlow(true);
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - last < 60_000) return;
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return; }
      window.location.reload();
    }, SLOW_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`${className} flex flex-col items-center justify-center gap-4 p-6 text-center`} aria-busy="true" aria-live="polite">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#51A6FB]" />
      <p className="text-sm text-muted-foreground">{slow ? "Still loading. Trying again..." : "Loading your page..."}</p>
      {slow && (
        <button type="button" className="text-sm underline" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </div>
  );
}
