/**
 * Lifecycle guards for VoiceExplainModal, kept free of React so they can be
 * tested deterministically (voiceLifecycle.test.ts).
 *
 *  - createEpoch: a counter bumped on close, unmount, abandon and every new
 *    recording. Any async continuation (microphone, upload, enqueue, poll)
 *    captures the epoch it started in and does nothing if it has changed.
 *  - uploadRegistry: remembers, for the whole page (not one dialog instance),
 *    which recording slots have a save in flight - before any recovery marker
 *    exists - so a closed-and-reopened dialog cannot start a second recording
 *    over it, and can wait for it instead.
 *  - createSafeStore: localStorage with in-memory overrides (values and
 *    removal tombstones) for browsers where storage, or only writing to it,
 *    is blocked.
 *  - scoreToShow: a number only for a server status that permits one.
 */

export function createEpoch() {
  let current = 0;
  return {
    get current() { return current; },
    /** Invalidate everything started before now; returns the new epoch. */
    next(): number { current += 1; return current; },
    isCurrent(e: number): boolean { return e === current; },
  };
}

type Listener = () => void;

export function createUploadRegistry() {
  const active = new Map<string, symbol>();
  const listeners = new Map<string, Set<Listener>>();
  const notify = (key: string) => { for (const fn of listeners.get(key) ?? []) fn(); };
  return {
    /** A save for this slot has started. Returns a token only the same save can end. */
    begin(key: string): symbol {
      const token = Symbol(key);
      active.set(key, token);
      notify(key);
      return token;
    },
    /** The save that holds `token` has finished (either way). A stale token is ignored. */
    end(key: string, token: symbol): void {
      if (active.get(key) !== token) return;
      active.delete(key);
      notify(key);
    },
    isActive(key: string): boolean { return active.has(key); },
    subscribe(key: string, fn: Listener): () => void {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(fn);
      return () => { listeners.get(key)?.delete(fn); };
    },
  };
}

/** One registry for the whole page: saves outlive the dialog that started them. */
export const uploadRegistry = createUploadRegistry();

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * localStorage when it works; an in-memory override when a write or a removal
 * fails (blocked storage, private mode, quota, a read-only profile).
 *
 * Reads can work while writes or removals throw. So a failed write keeps the
 * new value in memory, and a failed removal keeps a tombstone - both win over
 * whatever older value is still persisted, for the rest of this page. Each
 * later access first tries to write the override through; once storage
 * accepts it again the override is dropped and storage is the source of truth.
 * A removal that cannot delete also tries to blank the value, so a reload
 * does not bring an abandoned marker back where writes still work.
 */
export function createSafeStore(getStorage: () => KeyValueStore) {
  const override = new Map<string, string | null>();   // null = removed (tombstone)
  const attempt = (fn: (s: KeyValueStore) => void): boolean => {
    try { fn(getStorage()); return true; } catch { return false; }
  };
  const persist = (key: string, value: string | null): boolean =>
    value === null
      ? attempt((s) => s.removeItem(key)) || attempt((s) => s.setItem(key, ""))
      : attempt((s) => s.setItem(key, value));
  const flush = (key: string) => {
    if (override.has(key) && persist(key, override.get(key)!)) override.delete(key);
  };
  return {
    get(key: string): string | null {
      flush(key);
      if (override.has(key)) return override.get(key)!;
      let v: string | null = null;
      if (!attempt((s) => { v = s.getItem(key); })) return null;
      return v || null;                       // "" is a blanked (removed) value
    },
    set(key: string, value: string): void {
      if (persist(key, value)) override.delete(key);
      else override.set(key, value);
    },
    remove(key: string): void {
      if (attempt((s) => s.removeItem(key))) override.delete(key);
      else { override.set(key, null); attempt((s) => s.setItem(key, "")); }
    },
  };
}

export const safeStore = createSafeStore(() => window.localStorage);

/** A score is shown or exported only when the server says the recording is scored. */
export function scoreToShow(status: string | null | undefined, score: number | null | undefined): number | null {
  if (status !== "scored") return null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * The recording clock, from real elapsed time (Date.now) rather than a count
 * of timer ticks - background tabs throttle timers, so counting ticks lets a
 * recording run past the limit.
 */
export function recordingClock(startedAtMs: number, nowMs: number, maxSeconds: number) {
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const secondsLeft = Math.max(0, Math.ceil((maxSeconds * 1000 - elapsedMs) / 1000));
  return { elapsedMs, secondsLeft, expired: elapsedMs >= maxSeconds * 1000 };
}

/** Recorded length for the server: real elapsed seconds, never above the limit. */
export function recordedSeconds(startedAtMs: number, stoppedAtMs: number, maxSeconds: number): number {
  return Math.min(maxSeconds, Math.max(0, Math.round((stoppedAtMs - startedAtMs) / 1000)));
}

/** The PDF export entry: the score only when it is the confirmed, shown score. */
export function exportEntry(
  result: { transcript: string; score: number | null; notes: string | null },
  prompt: string,
) {
  const score = typeof result.score === "number" && Number.isFinite(result.score) ? result.score : null;
  return { question: prompt, transcript: result.transcript, score, feedback: result.notes };
}

/** Clear a recovery marker only if it still belongs to this recording. */
export function markerBelongsTo(storedVoiceId: string | null | undefined, voiceId: string): boolean {
  return storedVoiceId === voiceId;
}

/**
 * A request's answer, or `fallback` after `ms`. The request itself may still
 * finish later (the caller's epoch/ownership check then ignores it); what
 * matters is that nothing waits forever on a request that never answers.
 */
export function settleWithin<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

/**
 * Tolerance for the decoded length of a recording (the recorder's last chunk
 * and codec padding run slightly past the stop). Anything longer than the
 * limit plus this was recorded while the page could not stop it in time - a
 * suspended or frozen tab - and is not uploaded.
 */
export const LENGTH_TOLERANCE_SECONDS = 2;

/** `true` only when the audio is known to be too long; unknown length (decode failed) is not. */
export function audioTooLong(decodedSeconds: number | null, maxSeconds: number): boolean {
  return decodedSeconds !== null && Number.isFinite(decodedSeconds) && decodedSeconds > maxSeconds + LENGTH_TOLERANCE_SECONDS;
}
