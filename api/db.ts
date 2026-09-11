// The one piece of this service that security depends on.
//
// Every query runs inside a transaction that first declares who the caller is:
//
//     BEGIN
//     SET LOCAL ROLE authenticated
//     SET LOCAL request.jwt.claims = '{"sub":"<user id>",...}'
//     <the query>
//     COMMIT
//
// auth.uid() reads that setting, and the 145 RLS policies read auth.uid(). So
// this file does not decide what anyone may see - it only states who is asking,
// and the database answers. A bug here cannot widen access beyond what the
// policies already allow; it can only mislabel the caller, which the tests
// check for directly.
//
// SET LOCAL, never SET. LOCAL is scoped to the transaction, so the setting is
// gone the moment it commits. With a connection pool that is the difference
// between safe and catastrophic: a plain SET would persist on the pooled
// connection and the next request to borrow it would inherit the previous
// caller's identity.
import { Pool, type PoolClient } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';

const pool = new Pool(
  {
    hostname: Deno.env.get('PGHOST') ?? '127.0.0.1',
    port: Number(Deno.env.get('PGPORT') ?? 5433),
    user: Deno.env.get('PGUSER') ?? 'prooflab_app',
    password: Deno.env.get('PGPASSWORD') ?? '',
    database: Deno.env.get('PGDATABASE') ?? 'prooflab',
    tls: { enabled: false }, // the Cloud SQL proxy already encrypts the hop
  },
  Number(Deno.env.get('PG_POOL_SIZE') ?? 5),
  true, // lazy: don't open connections until the first request
);

export interface Claims {
  sub: string;
  role?: string;
  email?: string;
}

/**
 * Run `fn` with the database believing it is talking to `claims.sub`.
 *
 * Pass null for an anonymous caller: the role becomes `anon` and no claims are
 * set, so auth.uid() is null and every own-row policy fails shut.
 */
export async function asUser<T>(
  claims: Claims | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.queryArray('BEGIN');
    if (claims) {
      await client.queryArray(`SET LOCAL ROLE authenticated`);
      // Parameterised: the claims are attacker-influenced data and must never
      // be concatenated into SQL.
      await client.queryArray(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ role: 'authenticated', ...claims })],
      );
    } else {
      await client.queryArray(`SET LOCAL ROLE anon`);
    }
    const out = await fn(client);
    await client.queryArray('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.queryArray('ROLLBACK');
    } catch { /* the connection is already unusable; the pool will drop it */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Closes the pool. Used by the tests so the process can exit. */
export async function end(): Promise<void> {
  await pool.end();
}
