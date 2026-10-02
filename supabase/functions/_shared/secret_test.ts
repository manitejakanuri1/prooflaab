import { secretMatches } from './secret.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('secretMatches accepts only the exact secret', () => {
  assert(secretMatches('abc123', 'abc123'), 'exact secret refused');
  assert(!secretMatches('abc124', 'abc123'), 'last char differs but accepted');
  assert(!secretMatches('abc12', 'abc123'), 'prefix accepted');
  assert(!secretMatches('abc1234', 'abc123'), 'longer value accepted');
  assert(!secretMatches('', 'abc123'), 'empty accepted');
  assert(!secretMatches(null, 'abc123'), 'missing header accepted');
  assert(!secretMatches('abc123', ''), 'unset secret accepted');
  assert(!secretMatches('abc123', undefined), 'undefined secret accepted');
});
