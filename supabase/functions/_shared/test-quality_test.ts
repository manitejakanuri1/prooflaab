import { structuralProblems, constantProgram, echoProgram } from './test-quality.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const t = (
  id: string,
  stdin: string,
  out: string,
  visible = false,
  kind: 'normal' | 'boundary' | 'edge' = 'normal',
) => ({ id, stdin, expected_output: out, visible, kind });

Deno.test('the 3 Oct constant-output config is rejected', () => {
  const tests = [t('t1', '', 'EDIT\nFAILED', true), t('t2', '', 'EDIT\nFAILED'), t('t3', '', 'EDIT\nFAILED')];
  const p = structuralProblems(tests);
  assert(p.some((x) => x.includes('distinct input')), 'identical inputs not flagged');
  assert(p.some((x) => x.includes('same output')), 'identical outputs not flagged');
});

Deno.test('a sound small set passes the structural checks', () => {
  const tests = [
    t('t1', '3', '6', true, 'normal'),
    t('t2', '0', '0', false, 'boundary'),
    t('t3', '-2', '-4', false, 'edge'),
    t('t4', '1000000', '2000000', false, 'boundary'),
  ];
  assert(structuralProblems(tests).length === 0, JSON.stringify(structuralProblems(tests)));
});

Deno.test('normal boundary and edge coverage are all required', () => {
  const missingEdge = [
    t('n', '5', '10', true, 'normal'),
    t('b1', '0', '0', false, 'boundary'),
    t('b2', '100', '200', false, 'boundary'),
  ];
  assert(
    structuralProblems(missingEdge).some((x) => x.includes('Missing edge')),
    'test set with no edge case was accepted',
  );

  const complete = [
    t('n', '5', '10', true, 'normal'),
    t('b', '0', '0', false, 'boundary'),
    t('e', '-2', '-4', false, 'edge'),
  ];
  assert(
    !structuralProblems(complete).some((x) => x.startsWith('Missing ')),
    'complete normal/boundary/edge taxonomy was rejected',
  );
});

Deno.test('test depth scales with declared difficulty', () => {
  const make = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      t(
        `t${i}`,
        String(i),
        String(i * 2),
        i === 0,
        i === 0 ? 'normal' : i === 1 ? 'boundary' : i === 2 ? 'edge' : 'normal',
      )
    );

  assert(
    structuralProblems(make(4), 'Easy').every((x) => !x.includes('coding tasks require')),
    'valid Easy test count rejected',
  );
  assert(
    structuralProblems(make(6), 'Easy').some((x) => x.includes('Easy coding tasks require 4-5')),
    'too many Easy tests accepted',
  );

  assert(
    structuralProblems(make(5), 'Medium').some((x) => x.includes('Medium coding tasks require 6-8')),
    'too few Medium tests accepted',
  );
  assert(
    structuralProblems(make(6), 'Medium').every((x) => !x.includes('coding tasks require')),
    'valid Medium test count rejected',
  );

  assert(
    structuralProblems(make(7), 'Hard').some((x) => x.includes('Hard coding tasks require 8-10')),
    'too few Hard tests accepted',
  );
  assert(
    structuralProblems(make(8), 'Hard').every((x) => !x.includes('coding tasks require')),
    'valid Hard test count rejected',
  );
});

Deno.test('hidden tests are required and must not be outnumbered by visible ones', () => {
  assert(structuralProblems([t('a', '1', '1', true), t('b', '2', '2', true), t('c', '3', '3', true)])
    .some((x) => x.includes('No hidden')), 'all-visible set accepted');
  assert(structuralProblems([t('a', '1', '1', true), t('b', '2', '2', true), t('c', '3', '3')])
    .some((x) => x.includes('More visible')), 'visible > hidden accepted');
});

Deno.test('probe programs exist for every runner language', () => {
  for (const lang of ['python', 'javascript', 'ruby', 'php', 'c', 'cpp', 'go', 'java']) {
    assert(!!constantProgram(lang, 'x') && !!echoProgram(lang), `no probe for ${lang}`);
  }
  assert(constantProgram('ruby', 'a#{b}')!.includes('\\#{'), 'ruby interpolation not escaped');
  assert(constantProgram('php', "it's $x")! === "<?php echo 'it\\'s $x';", 'php literal wrong');
});
