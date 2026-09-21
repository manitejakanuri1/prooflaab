import { supabase } from "@/integrations/supabase/client";
import { setCallObserver, SESSION_ID } from "@/integrations/google/client";

/**
 * The student's step trail: which page they opened, which button they pressed, which server call ran and
 * whether it worked, and any screen error. Sent in small batches to the client-log function and kept 90 days.
 *
 * It records the STEP, never the content: no typed text, no answers, no resume text, no voice. Button labels
 * are cut to 50 characters and the server scrubs emails and keys again. It only runs inside the student area,
 * and a failure to send is ignored: the trail must never break a screen.
 */

export interface TrackEvent {
  kind: "page" | "click" | "call" | "error";
  screen?: string;
  action?: string;
  target?: string;
  status?: "ok" | "error";
  duration_ms?: number;
  request_id?: string;
  detail?: { message?: string; http?: number };
}
type Queued = TrackEvent & { ts: number; session_id: string; app_version: string };

const APP_VERSION = "v34";
const MAX_QUEUE = 200;
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;
let sending = false;

export function setTracking(on: boolean) {
  enabled = on;
  if (!on) queue = [];
}

export function track(e: TrackEvent) {
  if (!enabled) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ ...e, ts: Date.now(), session_id: SESSION_ID, app_version: APP_VERSION });
  if (queue.length >= 20) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), 5000);
}

export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (sending || queue.length === 0) return;
  sending = true;
  const batch = queue.splice(0, 50);
  try {
    await supabase.functions.invoke("client-log", { body: { events: batch } });
  } catch {
    /* never surface a tracking failure */
  } finally {
    sending = false;
    if (queue.length > 0 && !timer) timer = setTimeout(() => void flush(), 5000);
  }
}

/** Server calls: every function call is recorded; table calls only when they fail or are slow. */
setCallObserver((c) => {
  if (c.target === "client-log") return;                       // never record the recorder
  if (c.lane === "rest" && c.status === "ok" && c.duration_ms < 1500) return;
  track({
    kind: "call",
    target: c.target,
    status: c.status,
    duration_ms: c.duration_ms,
    request_id: c.request_id,
    detail: c.status === "error" ? { http: c.http } : undefined,
  });
});

const label = (el: Element) =>
  (el.getAttribute("aria-label") || (el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 50);

/** One delegated listener for the whole page: presses on buttons, links and tabs. Inputs are ignored. */
export function startDomTracking() {
  const onClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    if (!target?.closest) return;
    const el = target.closest("button, a, [role='tab'], [role='menuitem'], [role='button']");
    if (!el || el.closest("input, textarea, [contenteditable='true']")) return;
    const text = label(el);
    if (text) track({ kind: "click", action: text, screen: location.pathname });
  };
  const onError = (ev: ErrorEvent) =>
    track({ kind: "error", screen: location.pathname, action: "uncaught", status: "error", detail: { message: String(ev.message).slice(0, 200) } });
  const onRejection = (ev: PromiseRejectionEvent) =>
    track({ kind: "error", screen: location.pathname, action: "promise", status: "error", detail: { message: String((ev.reason as Error)?.message ?? ev.reason).slice(0, 200) } });
  const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
  document.addEventListener("click", onClick, true);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("visibilitychange", onHide);
  return () => {
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("visibilitychange", onHide);
  };
}
