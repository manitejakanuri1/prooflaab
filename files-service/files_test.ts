// The guard is the whole service, so the tests are almost all refusals.
//
// Run: deno test --allow-net files_test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { callerOf, handler, ownerOf, resolve } from './main.ts';

const ME = '9f77c6d5-bd7c-489e-9410-3db888729328';
const SOMEONE_ELSE = '1ff6d149-acc1-441c-9899-d79c9894a9d0';

Deno.test('the owner is the folder the file sits in', () => {
  assertEquals(ownerOf(`resumes/${ME}/cv.pdf`), ME);
  assertEquals(ownerOf(`proofs/${ME}/task-1/proof.png`), ME);
  // No folder at all means no owner, which can never equal a caller's id.
  assertEquals(ownerOf('resumes/cv.pdf'), 'cv.pdf');
  assertEquals(ownerOf('resumes'), '');
});

Deno.test('a known bucket resolves to its real home', () => {
  const r = resolve(`/file/resumes/${ME}/cv.pdf`);
  assertEquals('error' in r, false);
  if (!('error' in r)) {
    assertEquals(r.object, `resumes/${ME}/cv.pdf`);
    assertEquals(r.isPublic, false);
  }
});

Deno.test('profile photos are the only public bucket', () => {
  const r = resolve(`/file/profile-photos/${ME}/me.jpg`);
  if ('error' in r) throw new Error('should have resolved');
  assertEquals(r.isPublic, true);
});

Deno.test('an invented bucket is refused', () => {
  assertEquals(resolve(`/file/payroll/${ME}/salaries.csv`), { error: 'unknown bucket' });
});

Deno.test('climbing out of the folder is refused, not tidied up', () => {
  // If this were normalised instead, the guard would check one path and Cloud
  // Storage would receive another - which is the whole bug class.
  assertEquals(resolve(`/file/resumes/${ME}/../${SOMEONE_ELSE}/cv.pdf`), { error: 'bad path' });
  assertEquals(resolve('/file/resumes//cv.pdf'), { error: 'bad path' });
  assertEquals(resolve('/file/resumes/'), { error: 'missing path' });
});

Deno.test('a private file with no token is refused', async () => {
  const res = await handler(
    new Request(`https://x/file/resumes/${ME}/cv.pdf`, { method: 'GET' }),
  );
  assertEquals(res.status, 401);
});

Deno.test('a private file with a forged token is refused', async () => {
  const res = await handler(
    new Request(`https://x/file/resumes/${ME}/cv.pdf`, {
      method: 'GET',
      headers: { Authorization: 'Bearer not.a.real.token' },
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test('an upload with no token is refused before any byte is read', async () => {
  const res = await handler(
    new Request(`https://x/file/proofs/${ME}/proof.png`, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test('an unknown path is not found', async () => {
  const res = await handler(new Request('https://x/admin', { method: 'GET' }));
  assertEquals(res.status, 404);
});

Deno.test('preflight is answered without a token', async () => {
  const res = await handler(
    new Request(`https://x/file/resumes/${ME}/cv.pdf`, { method: 'OPTIONS' }),
  );
  assertEquals(res.status, 204);
});

// --- the database token -------------------------------------------------------
// Every account created after the move has a Google id that is not its uuid, so
// the file service must identify callers by the bridge's token. These pin down
// that it does - and that only a person's token counts.

async function hs256(claims: Record<string, unknown>): Promise<string> {
  const b64 = (b: Uint8Array | string) =>
    btoa(typeof b === 'string' ? b : String.fromCharCode(...b))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(Deno.env.get('PGRST_JWT_SECRET')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(sig)}`;
}
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

Deno.test('a signed-in database token names its uuid', async () => {
  assertEquals(await callerOf(await hs256({ sub: ME, role: 'authenticated', exp: inAnHour() })), ME);
});

Deno.test('a service_role token is not a person', async () => {
  assertEquals(await callerOf(await hs256({ role: 'service_role', exp: inAnHour() })), null);
});

Deno.test('a file grant cannot be used to act as someone', async () => {
  assertEquals(await callerOf(await hs256({ sub: ME, role: 'authenticated', obj: `resumes/${ME}/cv.pdf`, exp: inAnHour() })), null);
});

Deno.test('an expired database token is refused', async () => {
  assertEquals(await callerOf(await hs256({ sub: ME, role: 'authenticated', exp: 1 })), null);
});

Deno.test("a valid token still cannot reach someone else's folder", async () => {
  const token = await hs256({ sub: SOMEONE_ELSE, role: 'authenticated', exp: inAnHour() });
  const res = await handler(
    new Request(`https://x/file/resumes/${ME}/cv.pdf`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
  );
  assertEquals(res.status, 404);
});
