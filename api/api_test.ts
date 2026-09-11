// Does the API hand each caller only their own rows?
//
// This is the Phase 2 method applied to the API instead of to raw SQL: call the
// same endpoint as different people and check nobody sees anyone else's row.
// If this passes for one endpoint, the pattern is sound for the other 122.
//
// Needs the Cloud SQL proxy running and PGPASSWORD set:
//   deno test --allow-net --allow-env api/api_test.ts
import { create } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import { handler } from './main.ts';
import { end } from './db.ts';

const SECRET = Deno.env.get('API_JWT_SECRET') ?? '';
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(SECRET),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify'],
);

const STUDENT = '9f77c6d5-bd7c-489e-9410-3db888729328';
const OTHER_STUDENT = 'e724043f-cba0-4df6-a4ad-03eb17bf223f';
const TPO = '1ff6d149-acc1-441c-9899-d79c9894a9d0';

async function tokenFor(sub: string): Promise<string> {
  return await create({ alg: 'HS256', typ: 'JWT' }, { sub, role: 'authenticated' }, key);
}

async function get(token?: string) {
  const headers: Record<string, string> = { Origin: 'https://prooflaab.vercel.app' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(
    new Request('http://localhost/api/student_profiles', { method: 'GET', headers }),
  );
  return { status: res.status, body: await res.json() };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('a student sees exactly one row - their own', async () => {
  const { status, body } = await get(await tokenFor(STUDENT));
  assert(status === 200, `status ${status}`);
  assert(body.count === 1, `expected 1 row, got ${body.count}`);
  assert(body.rows[0].id === STUDENT, `got someone else's row: ${body.rows[0].id}`);
});

Deno.test('a different student sees a DIFFERENT single row', async () => {
  // The sharpest test in the file. If the pooled connection leaked the previous
  // caller's identity, this returns the first student's row and fails here.
  const { body } = await get(await tokenFor(OTHER_STUDENT));
  assert(body.count === 1, `expected 1 row, got ${body.count}`);
  assert(
    body.rows[0].id === OTHER_STUDENT,
    `identity leaked between requests: got ${body.rows[0].id}`,
  );
});

Deno.test('the college admin sees their whole college', async () => {
  const { body } = await get(await tokenFor(TPO));
  assert(body.count === 3, `expected 3 students, got ${body.count}`);
});

Deno.test('no token is refused, and told so honestly', async () => {
  // anon holds no grant on student_profiles, so this is 401 rather than an
  // empty list. Returning [] would assert the table is empty, which is false -
  // the caller simply may not look.
  const { status, body } = await get();
  assert(status === 401, `expected 401, got ${status}`);
  assert(body.rows === undefined, 'a refused caller must not receive rows');
});

Deno.test('a forged token is treated as anonymous, not trusted', async () => {
  const wrongKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('not-the-real-secret-not-the-real-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const forged = await create({ alg: 'HS256', typ: 'JWT' }, { sub: TPO, role: 'authenticated' }, wrongKey);
  const { status, body } = await get(forged);
  assert(status === 401, `expected 401, got ${status}`);
  assert(body.rows === undefined, 'a rejected token must not receive rows');
});

Deno.test('a token with no sub is rejected', async () => {
  const noSub = await create({ alg: 'HS256', typ: 'JWT' }, { role: 'authenticated' }, key);
  const { status, body } = await get(noSub);
  assert(status === 401, `expected 401, got ${status}`);
  assert(body.rows === undefined, 'a rejected token must not receive rows');
});

Deno.test('garbage in the Authorization header is not fatal', async () => {
  const { status, body } = await get('this-is-not-a-jwt');
  assert(status === 401, `expected 401, got ${status}`);
  assert(body.rows === undefined, 'garbage token returned rows');
});

// The pool has to be closed or the test process hangs.
globalThis.addEventListener('unload', () => { void end(); });
