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
  const headers: Record<string, string> = { Origin: 'https://prooflab.co.in' };
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

Deno.test('a browser preflight is answered, and carries the headers', async () => {
  // This exact case returned 500 in production: a 204 with a body, which Deno
  // refuses. Every browser sends this before the real request, so the login was
  // blocked before it started while a direct POST looked perfectly healthy.
  const res = await handler(
    new Request('https://bridge/token', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://prooflab.co.in',
        'Access-Control-Request-Method': 'POST',
      },
    }),
  );
  assert(res.status === 204, `preflight answered ${res.status}, not 204`);
  assert(
    res.headers.get('Access-Control-Allow-Origin') === 'https://prooflab.co.in',
    'preflight did not allow the calling site',
  );
  assert(res.body === null, 'a 204 must carry no body - that is what threw');
});

// ── F1: the asymmetric signer and service callers ───────────────────────────
import { makeSigner, verifyServiceCaller } from './signer.ts';

async function rsa() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pair, pem };
}
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

Deno.test('RS256 signer: the published public key verifies the token; a second key does not', async () => {
  const { pem } = await rsa();
  const signer = await makeSigner(pem, 'unused');
  assert(signer.alg === 'RS256', 'not RS256');
  const token = await signer.sign({ sub: SUB, role: 'authenticated', exp: future });
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(fromB64(h)));
  const jwk = signer.jwks().keys[0];
  assert(header.alg === 'RS256' && header.kid === jwk.kid, 'kid does not match the published key');
  assert(!('d' in jwk) && !('p' in jwk), 'the published key leaks private numbers');
  const pub = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${h}.${p}`);
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, fromB64(sig), signed), 'own public key rejects own token');
  const other = (await rsa()).pair.publicKey;
  assert(!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', other, fromB64(sig), signed)), 'a different key accepted the token');
});

Deno.test('without a signing key the bridge still signs HS256 and publishes no keys', async () => {
  const signer = await makeSigner('', 'any-32-character-string-will-do-here');
  assert(signer.alg === 'HS256' && signer.jwks().keys.length === 0, 'legacy mode changed');
});

Deno.test('service callers: only a listed service account, for this audience, signed by Google', async () => {
  const { pair } = await rsa();
  const signer = async (payload: object, key = pair.privateKey, header: object = { alg: 'RS256', kid: 'k1' }) => {
    const body = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body)));
    return `${body}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  };
  const opts = {
    keyFor: (kid: string) => Promise.resolve(kid === 'k1' ? pair.publicKey : null),
    audience: 'https://bridge.example', allowed: ['functions@p.iam.gserviceaccount.com'],
  };
  const good = { iss: 'https://accounts.google.com', aud: 'https://bridge.example', exp: future,
    email: 'functions@p.iam.gserviceaccount.com', email_verified: true };
  assert(await verifyServiceCaller(await signer(good), opts) === good.email, 'a listed caller was refused');
  const refusals: [string, string][] = [
    ['unlisted account', await signer({ ...good, email: 'stranger@p.iam.gserviceaccount.com' })],
    ['wrong audience', await signer({ ...good, aud: 'https://other.example' })],
    ['expired', await signer({ ...good, exp: past })],
    ['not issued by Google', await signer({ ...good, iss: 'https://evil.example' })],
    ['email not verified', await signer({ ...good, email_verified: false })],
    ['signed by another key', await signer(good, (await rsa()).pair.privateKey)],
    ['unknown kid', await signer(good, pair.privateKey, { alg: 'RS256', kid: 'nope' })],
    ['alg none', fakeToken({ alg: 'none', kid: 'k1' }, good, '')],
    ['garbage', 'not.a.token'],
  ];
  for (const [name, token] of refusals) {
    assert(await verifyServiceCaller(token, opts) === null, `accepted: ${name}`);
  }
  assert(await verifyServiceCaller(await signer(good), { ...opts, allowed: [] }) === null, 'an empty allow-list accepted a caller');
});

Deno.test('/service-token is closed when the bridge has no asymmetric key', async () => {
  const res = await handler(new Request('https://bridge/service-token', { method: 'POST', headers: { Authorization: 'Bearer x.y.z' } }));
  assert(res.status === 401, `status ${res.status}`);
});
