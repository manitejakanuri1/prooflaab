import { structuralProblems, constantProgram, echoProgram } from './test-quality.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const t = (id: string, stdin: string, out: string, visible = false) => ({ id, stdin, expected_output: out, visible });

Deno.test('the 3 Oct constant-output config is rejected', () => {
  const tests = [t('t1', '', 'EDIT\nFAILED', true), t('t2', '', 'EDIT\nFAILED'), t('t3', '', 'EDIT\nFAILED')];
  const p = structuralProblems(tests);
  assert(p.some((x) => x.includes('distinct input')), 'identical inputs not flagged');
  assert(p.some((x) => x.includes('same output')), 'identical outputs not flagged');
});

Deno.test('a sound small set passes the structural checks', () => {
  const tests = [t('t1', '3', '6', true), t('t2', '0', '0'), t('t3', '-2', '-4'), t('t4', '1000000', '2000000')];
  assert(structuralProblems(tests).length === 0, JSON.stringify(structuralProblems(tests)));
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
