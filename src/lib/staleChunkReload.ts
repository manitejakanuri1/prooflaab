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

const RELOAD_FLAG = 'stale-chunk-reloads';
// Retest 3 (11 Nov 2026): one reload was not enough while a deploy is still uploading - the fresh index.html can
// name files that are not there yet. Try up to three times, waiting longer each time; the count resets after
// two minutes so a later deploy in the same session still recovers.
const WAITS_MS = [0, 5_000, 15_000];
const RESET_AFTER_MS = 120_000;

export function looksLikeStaleChunk(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  );
}

let scheduled = false;

function showReloadBanner(): void {
  if (document.getElementById('stale-chunk-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'stale-chunk-banner';
  bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:9999;padding:12px 16px;border-radius:10px;'
    + 'background:#0f172a;color:#fff;font:14px system-ui,sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between';
  bar.textContent = 'ProofLab was just updated and this page did not load.';
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'background:#fff;color:#0f172a;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer';
  btn.onclick = () => window.location.reload();
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

/** Reload to pick up the new build; after three tries, show a Reload button instead of a blank page. */
export function reloadForStaleChunk(): void {
  if (scheduled) return;
  let tries = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(RELOAD_FLAG) ?? 'null') as { n: number; at: number } | null;
    tries = saved && Date.now() - saved.at < RESET_AFTER_MS ? saved.n : 0;
    if (tries < WAITS_MS.length) sessionStorage.setItem(RELOAD_FLAG, JSON.stringify({ n: tries + 1, at: Date.now() }));
  } catch {
    // Private browsing can refuse sessionStorage: reload once each time; still better than a white screen.
  }
  if (tries >= WAITS_MS.length) {
    console.error('Chunk still missing after reloads; showing a Reload button.');
    showReloadBanner();
    return;
  }
  scheduled = true;
  setTimeout(() => window.location.reload(), WAITS_MS[tries]);
}

export function installStaleChunkReload(): void {
  // Vite raises this for a failed modulepreload, which is the usual first sign.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadForStaleChunk();
  });

  // The import itself rejects separately when there was no preload to fail.
  window.addEventListener('unhandledrejection', (event) => {
    if (looksLikeStaleChunk(event.reason)) {
      event.preventDefault();
      reloadForStaleChunk();
    }
  });
}
