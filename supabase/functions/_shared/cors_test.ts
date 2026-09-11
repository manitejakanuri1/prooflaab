// Guards the CORS rules. Run with:
//   deno test --allow-read --allow-env supabase/functions/_shared/cors_test.ts
import { cors, corsHeaders } from './cors.ts';

const FUNCTIONS_DIR = new URL('../', import.meta.url);

async function sourceFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const dir of Deno.readDir(FUNCTIONS_DIR)) {
    if (!dir.isDirectory || dir.name === '_shared') continue;
    for await (const f of Deno.readDir(new URL(`${dir.name}/`, FUNCTIONS_DIR))) {
      if (f.name.endsWith('.ts')) out.push(`${dir.name}/${f.name}`);
    }
  }
  return out;
}

const req = (origin?: string) =>
  new Request('https://example.test/fn', {
    method: 'POST',
    headers: origin ? { Origin: origin } : {},
  });

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── the allowlist ───────────────────────────────────────────────────────────

Deno.test('the production origin is echoed back', () => {
  const h = cors(req('https://prooflaab.vercel.app'));
  assert(
    h['Access-Control-Allow-Origin'] === 'https://prooflaab.vercel.app',
    `got ${h['Access-Control-Allow-Origin']}`,
  );
});

Deno.test('a vercel preview build is allowed', () => {
  const h = cors(req('https://prooflaab-git-feature-x.vercel.app'));
  assert(
    h['Access-Control-Allow-Origin'] === 'https://prooflaab-git-feature-x.vercel.app',
    'preview builds must work, or every preview deploy is untestable',
  );
});

Deno.test('an unknown site is NOT echoed back', () => {
  const evil = 'https://evil-site.example';
  const h = cors(req(evil));
  assert(
    h['Access-Control-Allow-Origin'] !== evil,
    'echoing an arbitrary origin defeats the whole point of CORS',
  );
});

Deno.test('a lookalike hostname is refused', () => {
  // not a .vercel.app host, just something ending in the same letters
  const h = cors(req('https://notvercel.app'));
  assert(h['Access-Control-Allow-Origin'] !== 'https://notvercel.app', 'lookalike accepted');
});

Deno.test('a request with no Origin still gets a valid header', () => {
  const h = cors(req());
  assert(h['Access-Control-Allow-Origin'].startsWith('http'), 'must not be empty or undefined');
});

Deno.test('Vary: Origin is always set', () => {
  // Without it a cache can hand one origin's reply to a different origin.
  assert(cors(req('https://prooflaab.vercel.app'))['Vary'] === 'Origin', 'cors() missing Vary');
  assert(corsHeaders['Vary'] === 'Origin', 'static headers missing Vary');
});

Deno.test('never a wildcard', () => {
  for (const o of [undefined, 'https://prooflaab.vercel.app', 'https://evil.example']) {
    assert(cors(req(o))['Access-Control-Allow-Origin'] !== '*', `wildcard for origin ${o}`);
  }
  assert(corsHeaders['Access-Control-Allow-Origin'] !== '*', 'static headers are a wildcard');
});

// ── the functions themselves ────────────────────────────────────────────────

Deno.test('no function hardcodes a wildcard origin', async () => {
  const offenders: string[] = [];
  for (const rel of await sourceFiles()) {
    const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
    if (/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(src)) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`wildcard origin in: ${offenders.join(', ')}`);
});

Deno.test('every function gets its headers from the shared module', async () => {
  const offenders: string[] = [];
  for (const rel of await sourceFiles()) {
    const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
    if (src.includes('corsHeaders') && !src.includes('_shared/cors.ts')) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`local corsHeaders in: ${offenders.join(', ')}`);
});

Deno.test('every handler shadows the import with the request-aware version', async () => {
  // This is what makes the 251 `...corsHeaders` uses inside handlers pick up
  // the caller's origin. A function that imports cors() but forgets the line
  // would silently answer every caller with the default origin.
  const offenders: string[] = [];
  for (const rel of await sourceFiles()) {
    if (!rel.endsWith('index.ts')) continue;
    const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
    if (!src.includes('...corsHeaders')) continue;
    if (!src.includes('const corsHeaders = cors(req)')) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`handler does not shadow: ${offenders.join(', ')}`);
});
