/**
 * Keep a screen up to date without a live connection.
 *
 * Six screens subscribed to database changes over a websocket, which Supabase
 * serves from a separate Realtime server. PostgREST has no equivalent, so after
 * the move every one of those subscriptions failed and reconnected forever.
 *
 * The subscriptions are now stubbed, and this replaces what they were for. It is
 * plainer than a live feed and, for these screens, close enough: a notification
 * or a new submission arriving within half a minute is not meaningfully worse
 * than arriving instantly, and nothing here is a chat window.
 *
 * Two details that stop polling being a nuisance:
 *
 *   - Nothing is fetched while the tab is hidden. A dashboard left open in a
 *     background tab overnight would otherwise make thousands of requests for
 *     an audience of nobody.
 *   - A refresh happens immediately when the tab is looked at again, so coming
 *     back to it shows current data rather than whatever was last drawn.
 */
import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL = 30_000;

export function useLiveRefresh(refresh: () => void | Promise<void>, intervalMs = DEFAULT_INTERVAL) {
  // Held in a ref so a caller passing an inline function does not restart the
  // timer on every render - which would mean it never actually fires.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      if (document.visibilityState !== 'visible') return;
      void latest.current();
    };

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(run, intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();      // show current data the moment the tab is looked at
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
