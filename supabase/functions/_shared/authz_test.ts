// Tests for mayActOnStudentWork - the check that five functions were missing
// the college half of. Run with:
//   deno test --allow-read supabase/functions/_shared/authz_test.ts
import { mayActOnStudentWork, type StudentWork } from './authz.ts';

interface CollegeRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  verification_status: string;
}

/**
 * Enough of a PostgREST builder to answer the two queries the helper makes.
 * Thenable, because the user_roles query is awaited without maybeSingle().
 */
function stubClient(fixture: {
  roles: Record<string, string[]>;
  colleges: CollegeRow[];
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};

      const rows = (): Record<string, unknown>[] => {
        if (table === 'user_roles') {
          const uid = filters['user_id'] as string;
          return (fixture.roles[uid] ?? []).map((role) => ({ role }));
        }
        if (table === 'colleges') {
          return fixture.colleges.filter((c) =>
            Object.entries(filters).every(
              ([col, val]) => (c as unknown as Record<string, unknown>)[col] === val,
            )
          );
        }
        throw new Error(`unexpected table in test stub: ${table}`);
      };

      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
        then: (
          onOk: (v: { data: Record<string, unknown>[] }) => unknown,
          onErr?: (e: unknown) => unknown,
        ) => Promise.resolve({ data: rows() }).then(onOk, onErr),
      };
      return builder;
    },
  };
}

const OWNER = 'user-owner';
const ADMIN = 'user-admin';
const OWN_COLLEGE_ADMIN = 'user-college-a';
const OTHER_COLLEGE_ADMIN = 'user-college-b';
const PENDING_COLLEGE_ADMIN = 'user-college-c';
const STRANGER = 'user-stranger';

const COLLEGE_A = 'college-a';
const COLLEGE_C = 'college-c';

const client = stubClient({
  roles: {
    [OWNER]: ['student'],
    [ADMIN]: ['admin'],
    [OWN_COLLEGE_ADMIN]: ['college_admin'],
    [OTHER_COLLEGE_ADMIN]: ['college_admin'],
    [PENDING_COLLEGE_ADMIN]: ['college_admin'],
    [STRANGER]: ['student'],
  },
  colleges: [
    { id: COLLEGE_A, user_id: OWN_COLLEGE_ADMIN, verification_status: 'approved' },
    { id: 'college-b', user_id: OTHER_COLLEGE_ADMIN, verification_status: 'approved' },
    { id: COLLEGE_C, user_id: PENDING_COLLEGE_ADMIN, verification_status: 'pending' },
  ],
});

/** Work owned by OWNER, who studies at the approved college A. */
const WORK: StudentWork = { ownerUserId: OWNER, collegeId: COLLEGE_A };

async function check(caller: string, work: StudentWork = WORK): Promise<boolean> {
  return await mayActOnStudentWork(client, caller, work);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('the owner may act on their own work', async () => {
  assert(await check(OWNER), 'owner was refused');
});

Deno.test('a platform admin may act on anyone', async () => {
  assert(await check(ADMIN), 'admin was refused');
});

Deno.test('a college admin may act on their own approved college', async () => {
  assert(await check(OWN_COLLEGE_ADMIN), 'own college admin was refused');
});

Deno.test('a college admin may NOT act on another college', async () => {
  assert(!(await check(OTHER_COLLEGE_ADMIN)), 'cross-college access allowed - this is the bug');
});

Deno.test('an unapproved college admin may NOT act, even on their own students', async () => {
  const own = { ownerUserId: 'someone', collegeId: COLLEGE_C };
  assert(!(await check(PENDING_COLLEGE_ADMIN, own)), 'pending college was allowed');
});

Deno.test('an unrelated student may NOT act', async () => {
  assert(!(await check(STRANGER)), 'stranger was allowed');
});

Deno.test('work with no college is refused to every college admin', async () => {
  const orphan = { ownerUserId: 'someone', collegeId: null };
  assert(!(await check(OWN_COLLEGE_ADMIN, orphan)), 'null college was allowed');
});

Deno.test('an empty caller id is refused', async () => {
  assert(!(await check('')), 'empty caller was allowed');
});

Deno.test('a missing owner does not match a missing caller', async () => {
  const nobody = { ownerUserId: null, collegeId: null };
  assert(!(await check(STRANGER, nobody)), 'null owner matched');
});

// ── regression guard ────────────────────────────────────────────────────────
// The five functions that carried the unscoped check must keep routing through
// this helper. If one is rewritten to decide for itself again, this fails.
Deno.test('every function that reaches student work uses the shared helper', async () => {
  const MUST_IMPORT = [
    'proof-file-url',
    'moss-check',
    'ai-authorship',
    'github-check',
    'question-generator',
    'verify-proof',
    'trust-compute',
    'response-evaluator',
  ];
  const missing: string[] = [];
  for (const fn of MUST_IMPORT) {
    const src = await Deno.readTextFile(
      new URL(`../${fn}/index.ts`, import.meta.url),
    );
    if (!src.includes('_shared/authz.ts')) missing.push(fn);
  }
  if (missing.length) throw new Error(`no longer import authz.ts: ${missing.join(', ')}`);
});
