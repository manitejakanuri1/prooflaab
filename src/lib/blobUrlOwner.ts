/**
 * Owns the one local blob: URL VoiceExplainModal creates for the recording it
 * just made (passed to RecordingPlayback as `src`). Exactly one is alive at a
 * time: adopting a new one revokes the old, and release() revokes the current
 * one. Callers pair every release with dropping the URL from their state
 * (withoutLocalAudio), so a revoked URL is never rendered again - playback
 * then falls back to the stored file (authenticated storagePath download).
 * Tested in blobUrlOwner.test.ts.
 */
export function createBlobUrlOwner(revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)) {
  let current: string | null = null;
  return {
    get current() { return current; },
    /** Take ownership of a new URL; the previous one (if different) is revoked. */
    adopt(url: string): string {
      if (current && current !== url) revoke(current);
      current = url;
      return url;
    },
    /** Revoke the current URL, if any. Safe to call repeatedly. */
    release(): void {
      if (current) { revoke(current); current = null; }
    },
  };
}

/** The same result without its local blob: URL (keeps storagePath). */
export function withoutLocalAudio<T extends { audioUrl?: string }>(r: T | null): T | null {
  if (!r || r.audioUrl === undefined) return r;
  const { audioUrl: _dropped, ...rest } = r;
  return rest as T;
}
