/**
 * One web page built from a lesson's practice files (index.html, styles.css, script.js ...),
 * for the in-app "Try it yourself" box. Linked local css/js files are put inline, a lesson
 * with only script files gets a blank page around them, and console.log / errors are sent to
 * the parent window so the box can show them under the result.
 *
 * The page runs in an iframe with sandbox="allow-scripts" only: it cannot touch ProofLab's
 * cookies, storage or login. Replaces the StackBlitz embed (which loaded ad and tracking sites).
 */
const noEndScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");

// Sent to the parent as { practice: 1, level, text }.
const SPY = `<script>(function(){function send(level,args){try{parent.postMessage({practice:1,level:level,text:Array.prototype.map.call(args,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}}
['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o.apply(console,arguments)}});
window.addEventListener('error',function(e){send('error',[e.message])});
window.addEventListener('unhandledrejection',function(e){send('error',[String(e.reason)])});})();</script>`;

export function buildPracticeDoc(files: Record<string, string>): string {
  const names = Object.keys(files);
  const htmlName = names.find((n) => n.toLowerCase().endsWith(".html"));
  let html = htmlName ? files[htmlName] : "<!doctype html><html><head></head><body></body></html>";

  // <link href="styles.css"> -> <style>...</style> (only for files the lesson has)
  html = html.replace(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi, (m, href: string) =>
    href in files ? `<style>${files[href]}</style>` : m);
  // <script src="script.js"></script> -> <script>...</script>
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a: string, src: string, b: string) =>
    src in files ? `<script${a}${b}>${noEndScript(files[src])}</script>` : m);

  if (!htmlName) {
    const scripts = names.filter((n) => n.toLowerCase().endsWith(".js")).map((n) => `<script>${noEndScript(files[n])}</script>`).join("\n");
    html = html.replace("</body>", `${scripts}</body>`);
  }

  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + SPY) : SPY + html;
}
