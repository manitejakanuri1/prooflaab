import { clean } from './explain.ts';

Deno.test('the explainer prompt rule never reaches the student (QA round 2 item 6)', () => {
  const b = clean({ in_one_line: 'Fix the three wrong answers.', what_it_means: 'A sheet has mistakes. You are not solving the task now; you are just making the question clear. Find them.',
    steps: ['Read it.', 'Fix it.'], done_when: 'All three are fixed.' });
  if (!b || /not solving|question clear/i.test(b.what_it_means) || !b.what_it_means.includes('Find them.')) throw new Error(JSON.stringify(b));
});
