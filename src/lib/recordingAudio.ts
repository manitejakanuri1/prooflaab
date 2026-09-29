/**
 * Plays a private recording without a shareable link: the file is downloaded
 * with the student's own token (files-service checks the owner) and wrapped
 * in a temporary blob: URL that dies with the tab. Kept free of React so the
 * rules can be tested (recordingAudio.test.ts); useRecordingAudio wraps it.
 *
 * Rules: a second load while one is running is ignored; loading always ends
 * (error, missing data or a throw all end in `failed`, retryable); a replaced
 * or abandoned blob URL is revoked; nothing is created after dispose().
 */
export interface AudioState {
  url: string | null;
  loading: boolean;
  failed: boolean;
}

export interface AudioLoaderDeps {
  download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
  createUrl: (blob: Blob) => string;
  revoke: (url: string) => void;
  onChange: (state: AudioState) => void;
}

export function createAudioLoader(deps: AudioLoaderDeps) {
  let state: AudioState = { url: null, loading: false, failed: false };
  let disposed = false;
  const set = (patch: Partial<AudioState>) => {
    state = { ...state, ...patch };
    if (!disposed) deps.onChange(state);
  };

  return {
    get state() { return state; },
    async load(path: string | null | undefined): Promise<void> {
      if (!path || state.loading || disposed) return;
      set({ loading: true, failed: false });
      try {
        const { data, error } = await deps.download(path);
        if (disposed) return; // closed while downloading: create nothing
        if (error || !data) { set({ failed: true }); return; }
        const url = deps.createUrl(data);
        if (state.url) deps.revoke(state.url);
        set({ url });
      } catch {
        if (!disposed) set({ failed: true });
      } finally {
        if (!disposed) set({ loading: false });
      }
    },
    dispose(): void {
      disposed = true;
      if (state.url) { deps.revoke(state.url); state = { ...state, url: null }; }
    },
  };
}
