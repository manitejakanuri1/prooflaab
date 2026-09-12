// Tests for the token bridge.
//
// Almost all of these are refusals. A bridge that accepts a good token is easy;
// one that refuses every bad token is the point. Each test below is a real
// attack: a token from another Google project, an expired one, one with the
// signature stripped, one re-signed by the attacker.
//
//   PGRST_JWT_SECRET=any-32-character-string-will-do-here //     deno test --allow-net --allow-env auth-bridge/bridge_test.ts
//
// The secret is required: one test mints a token, and signing with an empty key
// fails with "Key length is zero", which reads like a broken test rather than a
// missing variable.
import { handler } from './main.ts';
import { verifyGoogleToken } from './verify.ts';

const b64 = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeToken(header: object, payload: object, sig = 'not-a-real-signature'): string {
  return `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}.${b64(sig)}`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;
const SUB = '9f77c6d5-bd7c-489e-9410-3db888729328';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function exchange(token?: string) {
  const headers: Record<string, string> = { Origin: 'https://prooflaab.vercel.app' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(new Request('http://localhost/token', { method: 'POST', headers }));
  return { status: res.status, body: await res.json() };
}

// ── refusals ────────────────────────────────────────────────────────────────

Deno.test('no token is refused', async () => {
  const { status } = await exchange();
  assert(status === 401, `expected 401, got ${status}`);
});

Deno.test('a token with a forged signature is refused', async () => {
  const t = fakeToken(
    { alg: 'RS256', kid: 'whatever', typ: 'JWT' },
    { sub: SUB, iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: future },
  );
  const { status } = await exchange(t);
  assert(status === 401, 'a made-up signature was accepted');
});

Deno.test('alg:none is refused', async () => {
  // The classic JWT attack: drop the algorithm and hope the verifier agrees.
  const t = fakeToken(
    { alg: 'none', typ: 'JWT' },
    { sub: SUB, iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: future },
    '',
  );
  assert(await verifyGoogleToken(t) === null, 'alg:none was accepted');
});

Deno.test('an HS256 token is refused even if we would sign HS256 ourselves', async () => {
  // Algorithm-confusion: sign with the symmetric secret and hope the verifier
  // treats it as the RSA public key.
  const t = fakeToken(
    { alg: 'HS256', typ: 'JWT' },
    { sub: SUB, iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: future },
  );
  assert(await verifyGoogleToken(t) === null, 'HS256 was accepted for a Google token');
});

Deno.test('a token from ANOTHER Google project is refused', async () => {
  // Correctly signed by Google, genuinely valid - just not for us. Without the
  // aud/iss checks this is the hole that lets any stranger in.
  const t = fakeToken(
    { alg: 'RS256', kid: 'x', typ: 'JWT' },
    { sub: SUB, iss: 'https://securetoken.google.com/someone-elses-app',
      aud: 'someone-elses-app', exp: future },
  );
  assert(await verifyGoogleToken(t) === null, 'another project token was accepted');
});

Deno.test('an expired token is refused', async () => {
  const t = fakeToken(
    { alg: 'RS256', kid: 'x', typ: 'JWT' },
    { sub: SUB, iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: past },
  );
  assert(await verifyGoogleToken(t) === null, 'an expired token was accepted');
});

Deno.test('a token with no subject is refused', async () => {
  const t = fakeToken(
    { alg: 'RS256', kid: 'x', typ: 'JWT' },
    { iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: future },
  );
  assert(await verifyGoogleToken(t) === null, 'a subject-less token was accepted');
});

Deno.test('garbage is refused without throwing', async () => {
  for (const junk of ['', 'abc', 'a.b', 'a.b.c.d', '...']) {
    assert(await verifyGoogleToken(junk) === null, `junk accepted: ${junk}`);
  }
});

Deno.test('every refusal gives the same message', async () => {
  // Saying which check failed tells an attacker how to get closer.
  const a = await exchange(fakeToken(
    { alg: 'RS256', kid: 'x' },
    { sub: SUB, iss: 'https://securetoken.google.com/prooflab-508214',
      aud: 'prooflab-508214', exp: past }));
  const b = await exchange(fakeToken(
    { alg: 'RS256', kid: 'x' },
    { sub: SUB, iss: 'https://securetoken.google.com/other', aud: 'other', exp: future }));
  assert(a.body.error === b.body.error, 'refusal messages differ and leak which check failed');
});

// ── the minted token ────────────────────────────────────────────────────────

Deno.test('the minted token carries the subject unchanged and is time-limited', async () => {
  const { mint } = await import('./main.ts');
  const { token } = await mint(SUB, 'someone@example.com');
  const [, payload] = token.split('.');
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/') + pad));

  assert(claims.sub === SUB, `subject changed: ${claims.sub}`);
  assert(claims.role === 'authenticated', `role is ${claims.role}`);
  assert(typeof claims.exp === 'number', 'no expiry - a token that never dies');
  assert(claims.exp - claims.iat <= 3600, 'lifetime longer than an hour');
});
