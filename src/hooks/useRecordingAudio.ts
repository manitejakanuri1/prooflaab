import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createAudioLoader, type AudioState } from "@/lib/recordingAudio";

/**
 * A stored recording, played through an authenticated download and a
 * temporary blob: URL (see lib/recordingAudio.ts). The blob URL is revoked
 * when the path changes or the component unmounts.
 */
export function useRecordingAudio(storagePath?: string | null) {
  const [state, setState] = useState<AudioState>({ url: null, loading: false, failed: false });
  const loaderRef = useRef<ReturnType<typeof createAudioLoader> | null>(null);

  useEffect(() => {
    const loader = createAudioLoader({
      download: (path) => supabase.storage.from("voice-explanations").download(path),
      createUrl: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
      onChange: setState,
    });
    loaderRef.current = loader;
    setState(loader.state);
    return () => {
      loader.dispose();
      loaderRef.current = null;
    };
  }, [storagePath]);

  const load = useCallback(() => {
    void loaderRef.current?.load(storagePath);
  }, [storagePath]);

  return { ...state, load };
}
