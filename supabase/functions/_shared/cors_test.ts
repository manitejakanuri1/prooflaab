// Guards the CORS fix: no edge function may go back to a wildcard origin, and
// none may use corsHeaders without importing the shared one. Run with:
//   deno test --allow-read --allow-env supabase/functions/_shared/cors_test.ts
import { corsHeaders } from './cors.ts';

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

Deno.test('no function serves a wildcard CORS origin', async () => {
  const offenders: string[] = [];
  for (const rel of await sourceFiles()) {
    const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
    if (/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(src)) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`wildcard origin in: ${offenders.join(', ')}`);
});

Deno.test('every corsHeaders user imports the shared module', async () => {
  const offenders: string[] = [];
  for (const rel of await sourceFiles()) {
    const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
    if (src.includes('corsHeaders') && !src.includes('_shared/cors.ts')) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`local corsHeaders in: ${offenders.join(', ')}`);
});

Deno.test('shared headers are well formed', () => {
  const origin = corsHeaders['Access-Control-Allow-Origin'];
  if (origin === '*') throw new Error('origin is a wildcard');
  if (!origin.startsWith('http')) throw new Error(`origin is not a URL: ${origin}`);
  if (corsHeaders['Vary'] !== 'Origin') throw new Error('missing Vary: Origin');
});
