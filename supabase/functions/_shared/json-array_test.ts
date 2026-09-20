import { firstJsonArray } from './json-array.ts';

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

Deno.test('a clean array parses', () => {
  eq(firstJsonArray('[{"id":"c1","test_cases":[{"stdin":"1"}]}]'), [{ id: 'c1', test_cases: [{ stdin: '1' }] }]);
});

Deno.test('text after the array that contains a ] no longer breaks it (the coding-round 500)', () => {
  // The old /\[[\s\S]*\]/ took up to the LAST "]" and JSON.parse threw
  // "Unexpected non-whitespace character after JSON".
  eq(firstJsonArray('[{"id":"c1"}]\nNote: see [the docs] for more'), [{ id: 'c1' }]);
  eq(firstJsonArray('[{"id":"c1"}]\n[{"id":"c2"}]'), [{ id: 'c1' }]);
});

Deno.test('markdown fences, leading text and trailing commas are tolerated', () => {
  eq(firstJsonArray('Here you go:\n```json\n[{"a":1,},{"a":2},]\n```'), [{ a: 1 }, { a: 2 }]);
});

Deno.test('brackets inside strings do not stop the parse early', () => {
  eq(firstJsonArray('[{"code":"x = [1, 2]"}]'), [{ code: 'x = [1, 2]' }]);
});

Deno.test('no array gives null', () => {
  eq(firstJsonArray('no json here'), null);
  eq(firstJsonArray('[{"a":'), null);
});
