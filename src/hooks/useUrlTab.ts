import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * A tab that lives in the address bar (?tab=lots&view=submissions) instead of in
 * component memory. That is what makes a dashboard section survive a refresh,
 * answer a pasted link, and follow the browser's Back and Forward buttons.
 *
 * `tab` is the destination (the sidebar); `view` is the tab inside it. Changing
 * the destination drops the inner view, so a view never leaks into a destination
 * that does not have it.
 */
export function useUrlTab(key: "tab" | "view", fallback: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) || fallback;

  const set = useCallback((next: string) => {
    // A tab control can report the same choice twice (press, then focus). Writing it twice
    // would add two history entries and make Back appear to do nothing.
    if ((new URLSearchParams(window.location.search).get(key) || fallback) === next) return;
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === fallback) p.delete(key); else p.set(key, next);
      if (key === "tab") p.delete("view");
      return p;
    });
  }, [key, fallback, setParams]);

  return [value, set];
}
