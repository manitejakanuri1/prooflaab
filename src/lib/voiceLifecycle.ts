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
 *  - createSafeStore: localStorage with an in-memory fallback, for browsers
 *    where storage is blocked or throws.
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
 * localStorage when it works, an in-memory map when it does not (blocked
 * storage, private mode, quota). The memory copy only lives for this page,
 * but it keeps close-and-reopen recovery working without persistence.
 */
export function createSafeStore(getStorage: () => KeyValueStore) {
  const memory = new Map<string, string>();
  const tryStorage = <T>(fn: (s: KeyValueStore) => T): { ok: true; value: T } | { ok: false } => {
    try { return { ok: true, value: fn(getStorage()) }; } catch { return { ok: false }; }
  };
  return {
    get(key: string): string | null {
      const r = tryStorage((s) => s.getItem(key));
      if (r.ok && r.value !== null) return r.value;
      return memory.has(key) ? memory.get(key)! : null;
    },
    set(key: string, value: string): void {
      memory.set(key, value);          // always, so a later blocked read still finds it
      tryStorage((s) => s.setItem(key, value));
    },
    remove(key: string): void {
      memory.delete(key);
      tryStorage((s) => s.removeItem(key));
    },
  };
}

export const safeStore = createSafeStore(() => window.localStorage);

/** A score is shown or exported only when the server says the recording is scored. */
export function scoreToShow(status: string | null | undefined, score: number | null | undefined): number | null {
  if (status !== "scored") return null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/** Clear a recovery marker only if it still belongs to this recording. */
export function markerBelongsTo(storedVoiceId: string | null | undefined, voiceId: string): boolean {
  return storedVoiceId === voiceId;
}
