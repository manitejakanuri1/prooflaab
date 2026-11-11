import { zeroUnquotedCredit } from './rubric-grading.ts';

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)}`); };
const answer = `Q2 is wrong: the chance of two heads is 1/4, not 1/2.
Q4 is wrong because the events are not independent.
Q5 is wrong - the “at least one” rule needs 1 minus none.
Revision list: complement rule, independence, counting.`;
const one = (evidence: string) => zeroUnquotedCredit([{ criterion_id: 'a', points: 25, evidence }], answer)[0].points;

Deno.test('a verbatim quote keeps its points', () => eq(one('Q4 is wrong because the events'), 25, 'verbatim'));
Deno.test('line breaks, curly quotes and dashes do not wipe a real quote', () => {
  eq(one('1/2. Q4 is wrong'), 25, 'line break');
  eq(one('Q5 is wrong – the "at least one" rule'), 25, 'dash and quotes');
});
Deno.test('a part needing several places may quote up to 3 pieces (QA round 2 item 9)', () => {
  eq(one('Q2 is wrong: the chance | Q4 is wrong because | Q5 is wrong - the'), 25, 'three pieces');
  eq(one('Q2 is wrong: the chance ... Revision list: complement'), 25, 'ellipsis');
});
Deno.test('made-up or too-short evidence still scores 0', () => {
  eq(one('Q3 is also wrong'), 0, 'not in answer');
  eq(one('Q2 is wrong: the chance | made up words here'), 0, 'one piece made up');
  eq(one('Q2'), 0, 'too short');
  eq(one('a b c d | e f g h | i j k l | m n o p'), 0, 'more than 3 pieces');
  eq(one(''), 0, 'empty');
});
