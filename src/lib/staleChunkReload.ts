/**
 * Recovers a tab that was open across a deploy.
 *
 * Every route in this app is lazily imported, so its JavaScript is fetched at
 * the moment you navigate to it. A deploy renames those files — each build
 * stamps a new content hash — and the old ones stop existing. A tab that loaded
 * the previous index.html is still holding the previous filenames, so the next
 * navigation asks for a file that is gone.
 *
 * It does not 404. The single-page rewrite in the hosting config answers every
 * unmatched path
 * with index.html, so the browser receives HTML where it expected a module,
 * refuses it on MIME grounds, and the dynamic import rejects. React renders
 * nothing and the page goes white. Nothing in the console names the deploy as
 * the cause, which is what made this hard to place.
 *
 * The page cannot repair itself in place: the correct filenames only exist in a
 * fresh index.html. So it reloads, once.
 */

const RELOAD_FLAG = 'stale-chunk-reloaded-at';
// Long enough that a genuinely broken deploy cannot reload forever, short
// enough that a second deploy later in the same session still recovers.
const RELOAD_COOLDOWN_MS = 30_000;

function looksLikeStaleChunk(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  );
}

function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) {
      // Already tried. Reloading again would loop on a deploy that is genuinely
      // missing a file, turning a white screen into a flickering one.
      console.error('Chunk still missing after reload; not retrying.');
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // Private browsing can refuse sessionStorage. Reloading unguarded is still
    // better than a permanent white screen.
  }
  window.location.reload();
}

export function installStaleChunkReload(): void {
  // Vite raises this for a failed modulepreload, which is the usual first sign.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnce();
  });

  // The import itself rejects separately when there was no preload to fail.
  window.addEventListener('unhandledrejection', (event) => {
    if (looksLikeStaleChunk(event.reason)) {
      event.preventDefault();
      reloadOnce();
    }
  });
}
