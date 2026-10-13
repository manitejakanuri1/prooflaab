// Security gate 14 Oct (run-1 P1): /token applies the website's managed-login rule (web_login_identity) before
// minting. Before, any login resolve_account knew got an API-usable token, including accounts the website refuses
// (no role, inactive/unapproved college, suspended or rejected organisation, unsupported role). Fails closed.
//
//   PGRST_JWT_SECRET=any-32-character-string-will-do-here deno test --allow-net --allow-env auth-bridge/login_policy_test.ts
import { exchangeVerified } from './main.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const UID = '00000000-0000-4000-8000-0000000000a1';
const VERIFIED = { sub: 'google-uid-1', email: 'a@example.test', email_verified: true };

function stub(policy: (() => Response) | 'throw', resolve: () => Response = () => Response.json({ user_id: UID, email_confirmed: true })) {
  const calls: string[] = [];
  const fetcher = (async (input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith('/rpc/resolve_account')) return resolve();
    if (url.endsWith('/rpc/web_login_identity')) {
      if (policy === 'throw') throw new TypeError('network down');
      return policy();
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { fetcher, calls };
}

async function run(policy: (() => Response) | 'throw', resolve?: () => Response) {
  const { fetcher, calls } = stub(policy, resolve);
  const res = await exchangeVerified(VERIFIED, 'https://prooflab.co.in', 'https://db.test', fetcher);
  const body = await res.json();
  return { status: res.status, body, calls };
}

const REFUSALS: Record<string, unknown> = {
  'no role (account_not_provisioned)': { allowed: false, reason: 'account_not_provisioned' },
  'student of an inactive college': { allowed: false, reason: 'college_inactive' },
  'suspended or rejected college admin': { allowed: false, reason: 'college_account_unavailable' },
  'unsupported role (recruiter)': { allowed: false, reason: 'unsupported_role' },
  'allowed but no role': { allowed: true },
  'a malformed answer': ['allowed'],
};
for (const [who, answer] of Object.entries(REFUSALS)) {
  Deno.test(`/token: ${who} -> 403 and no token`, async () => {
    const r = await run(() => Response.json(answer));
    assert(r.status === 403, `answered ${r.status}`);
    assert(!('access_token' in r.body), 'a token was issued');
  });
}

Deno.test('/token: the login rule cannot be read (500 or network) -> 503 and no token (fails closed)', async () => {
  for (const policy of [() => new Response('boom', { status: 500 }), 'throw' as const]) {
    const r = await run(policy);
    assert(r.status === 503 && !('access_token' in r.body), `answered ${r.status}`);
  }
});

Deno.test('/token: the rule is asked about the RESOLVED account, after resolve_account', async () => {
  const r = await run(() => Response.json({ allowed: true, role: 'student' }));
  assert(r.calls[0].endsWith('/rpc/resolve_account') && r.calls[1].endsWith('/rpc/web_login_identity'), r.calls.join(', '));
});

Deno.test('/token: account cannot be resolved -> 503 and the rule is not asked', async () => {
  const r = await run(() => Response.json({ allowed: true, role: 'student' }), () => new Response('x', { status: 500 }));
  assert(r.status === 503 && r.calls.length === 1, `answered ${r.status}, calls ${r.calls.join(', ')}`);
});

Deno.test('control: an allowed, provisioned login gets a token for its resolved account', async () => {
  const r = await run(() => Response.json({ allowed: true, role: 'college_admin' }));
  assert(r.status === 200 && typeof r.body.access_token === 'string', `answered ${r.status}`);
  const claims = JSON.parse(atob(r.body.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  assert(claims.sub === UID && claims.role === 'authenticated', JSON.stringify(claims));
});
