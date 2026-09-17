import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { clock, type TranscriptSegment } from "@/lib/transcribeAudio";

interface RecordingPlaybackProps {
  /** A local blob: URL right after recording, or… */
  src?: string;
  /** …the stored file, fetched only when the student presses Play. */
  storagePath?: string;
  transcript?: string | null;
  segments?: TranscriptSegment[] | null;
}

/**
 * The recording and what was said, together. Each line carries the moment it
 * was spoken; clicking it jumps the audio there.
 */
const RecordingPlayback = ({ src, storagePath, transcript, segments }: RecordingPlaybackProps) => {
  const [url, setUrl] = useState<string | null>(src ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => { if (!src && url) URL.revokeObjectURL(url); }, [src, url]);

  const load = async () => {
    if (!storagePath) return;
    setLoading(true);
    const { data } = await supabase.storage.from("voice-explanations").download(storagePath);
    setLoading(false);
    if (!data) { setFailed(true); return; }
    setUrl(URL.createObjectURL(data));
  };

  const seek = (s: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = s;
    audioRef.current.play().catch(() => { /* interrupted by another click - harmless */ });
  };

  // Chrome's recorder writes WebM with no duration in it, so the player shows no
  // length and its bar cannot be dragged. Seeking far past the end makes the
  // browser read the real length; then return to the start.
  const fixDuration = () => {
    const a = audioRef.current;
    if (!a || Number.isFinite(a.duration)) return;
    const back = () => { a.removeEventListener("durationchange", back); a.currentTime = 0; };
    a.addEventListener("durationchange", back);
    a.currentTime = 1e101;
  };

  return (
    <div className="space-y-2">
      {url ? (
        <audio ref={audioRef} src={url} controls preload="metadata" className="w-full"
               onLoadedMetadata={fixDuration} />
      ) : storagePath ? (
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          {failed ? "Could not load - try again" : "Play recording"}
        </Button>
      ) : null}

      {segments && segments.length > 0 ? (
        <ol className="space-y-1 text-sm">
          {segments.map((s, i) => (
            <li key={i} className="flex gap-2">
              <button type="button" onClick={() => seek(s.start)} disabled={!url}
                      className="font-mono text-xs tabular-nums text-primary shrink-0 pt-0.5 disabled:text-muted-foreground">
                {clock(s.start)}
              </button>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : transcript ? (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{transcript}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No words could be picked up from this recording.</p>
      )}
    </div>
  );
};

export default RecordingPlayback;
