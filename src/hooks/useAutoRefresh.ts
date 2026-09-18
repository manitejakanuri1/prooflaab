import { useEffect, useRef } from "react";

/**
 * Re-runs a page's loader when the person comes back to the tab and every
 * minute while it is visible, so a change made elsewhere (another admin, a
 * student, the nightly jobs) shows without pressing refresh. For screens that
 * load with useEffect; screens on React Query get the same from its defaults.
 */
export function useAutoRefresh(load: () => unknown, everyMs = 60_000) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const run = () => { if (document.visibilityState === "visible") void latest.current(); };
    const timer = window.setInterval(run, everyMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [everyMs]);
}
