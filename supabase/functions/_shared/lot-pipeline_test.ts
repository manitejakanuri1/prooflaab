import { guessGradingMode } from './lot-pipeline.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('grading mode needs real programming evidence', () => {
  assert(guessGradingMode('Infosys code of conduct and dress code', 'Employees follow the code of conduct.') === 'rubric',
    '"code of conduct" became a coding task');
  assert(guessGradingMode('TCS interview: one API question', 'They asked about our project and one API.') === 'rubric',
    'a single programming word became a coding task');
  assert(guessGradingMode('Python lists and loops', 'A list holds items; a for loop walks them.') === 'sandbox',
    'two programming words did not give a coding task');
  assert(guessGradingMode('Some page', 'Intro text\n```python\nprint(1)\n```') === 'sandbox',
    'a code block did not give a coding task');
});
