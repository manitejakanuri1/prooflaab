import { pageExcerpt } from './excerpt.ts';

const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };

// Shaped like the stored PrepInsta page: image, login wall, menu, then the real article.
const PREPINSTA = `
![Image 2: lock](blob:http://localhost/e8a5)

#### Unlock this article for Free,
 by logging in

Don’t worry, unlock all articles / blogs on PrepInsta by just simply logging in on our website

Sign in with Google Sign in with Google. Opens in new tab

*   [Prepare Prepare](https://prepinsta.com/x# "Prepare")
    *   [All Platforms](https://prepinsta.com/all "All Platforms")
        *   [AMCAT](https://prepinsta.com/amcat/ "AMCAT")
        *   [CoCubes](https://prepinsta.com/cocubes/ "CoCubes")

## TCS Interview Experience 2026

The TCS recruitment process has three rounds: an online aptitude test, a technical interview that covers projects and basic programming, and an HR interview about relocation and joining dates.
In the technical round the panel asked me to explain my final year project, write a program to reverse a string, and describe the difference between a list and a tuple in Python.
`;

Deno.test('a menu and a login box are skipped; the real article is what the AI sees', () => {
  const ex = pageExcerpt(PREPINSTA);
  assert(/three rounds/.test(ex), 'the article text should be in the excerpt');
  assert(/reverse a string/.test(ex), 'the questions should be in the excerpt');
  assert(!/Unlock this article|Sign in with Google|AMCAT|CoCubes/i.test(ex), 'menu and login text should be gone: ' + ex.slice(0, 100));
});

Deno.test('a plain page is kept as it is, and the length limit holds', () => {
  const page = 'Q. A train 120 metres long passes a pole in 6 seconds. What is its speed in km per hour?\n'.repeat(30);
  const ex = pageExcerpt(page, 800);
  assert(ex.startsWith('Q. A train'), 'plain text should start the excerpt');
  assert(ex.length <= 800, 'excerpt must respect the limit');
});

Deno.test('a page with almost no sentences falls back to its start', () => {
  const ex = pageExcerpt('# Skills\n\n- Python\n- SQL\n- Docker\n');
  assert(/Python/.test(ex), 'short list pages should still give something');
});

Deno.test('a run-on menu / promo strip is skipped', () => {
  const page = [
    'Projects Projects Industry Projects Placement ready projects Show recruiters your skills through real work',
    'TCS Aptitude TrainingTop 100 CodesTCS Ninja Recruitment Process TCS Aptitude Training Free Mock Test',
    'The panel asked me to explain my project, write a program to reverse a string, and describe the difference between a list and a tuple.',
  ].join('\n');
  const ex = pageExcerpt(page);
  assert(ex.startsWith('The panel asked'), 'should start at the real sentence, got: ' + ex.slice(0, 80));
});
