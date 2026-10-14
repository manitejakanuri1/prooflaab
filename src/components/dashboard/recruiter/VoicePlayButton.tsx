import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { type AudioState, createAudioLoader } from "@/lib/recordingAudio";

/**
 * A company plays one voice explanation. The audio comes from the
 * company-voice-play function, which checks the student's consent and records
 * the listen (migration 105); the page holds it as a temporary blob: URL that
 * dies with this component, never as a link. Shown only for a recording the
 * student has agreed to share.
 */
const VoicePlayButton = ({ voiceId }: { voiceId: string }) => {
  const [audio, setAudio] = useState<AudioState>({ url: null, loading: false, failed: false });
  const loader = useRef<ReturnType<typeof createAudioLoader> | null>(null);

  useEffect(() => {
    loader.current = createAudioLoader({
      download: async (id) => {
        const { data, error } = await supabase.functions.invoke("company-voice-play", { body: { voice_id: id } });
        return { data: data instanceof Blob ? data : null, error };
      },
      createUrl: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
      onChange: setAudio,
    });
    return () => loader.current?.dispose();
  }, [voiceId]);

  if (audio.url) {
    return <audio src={audio.url} controls autoPlay preload="metadata" className="h-9 max-w-[16rem]" />;
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Play recording"
        disabled={audio.loading}
        onClick={() => void loader.current?.load(voiceId)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary disabled:opacity-60"
      >
        {audio.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      {audio.failed && <span role="alert" className="text-xs text-destructive">Could not play. Try again.</span>}
    </div>
  );
};

export default VoicePlayButton;
