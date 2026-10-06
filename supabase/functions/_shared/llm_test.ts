import { generateText } from './llm.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('a connection reset to DeepSeek is retried once, and the second answer is used', async () => {
  const realFetch = globalThis.fetch;
  const saved = Deno.env.get('DEEPSEEK_API_KEY');
  Deno.env.set('DEEPSEEK_API_KEY', 'test-key');
  let deepseekCalls = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.deepseek.com/')) return Promise.resolve(new Response('{}', { status: 200 }));
    deepseekCalls++;
    if (deepseekCalls === 1) return Promise.reject(new TypeError('error sending request: connection reset'));
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await generateText('x', { skipRateLimit: true, cache: false });
    assert(r.provider === 'deepseek' && r.text === '{"ok":true}', `unexpected result ${JSON.stringify(r)}`);
    assert(deepseekCalls === 2, `expected one retry after the reset, saw ${deepseekCalls} calls`);
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) Deno.env.delete('DEEPSEEK_API_KEY'); else Deno.env.set('DEEPSEEK_API_KEY', saved);
  }
});
