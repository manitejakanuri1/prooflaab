// Shared text-generation helper with multi-key + multi-provider fallback.
// Tries every configured GEMINI_API_KEY* in order, then falls back to Kimi
// (Moonshot, OpenAI-compatible) if all Gemini keys are rate-limited/down.

interface GenOptions {
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean; // defaults true — every existing caller expects a JSON blob back
}

export interface GenResult {
  text: string;
  truncated: boolean;
  provider: 'gemini' | 'kimi';
}

function geminiKeys(): string[] {
  const keys = [
    Deno.env.get('GEMINI_API_KEY'),
    Deno.env.get('GEMINI_API_KEY_2'),
    Deno.env.get('GEMINI_API_KEY_3'),
  ].filter((k): k is string => !!k);
  return keys;
}

async function callGemini(prompt: string, apiKey: string, opts: GenOptions) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.5,
          maxOutputTokens: opts.maxOutputTokens ?? 2000,
          ...(opts.json !== false ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    }
  );
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';
  return { ok: true as const, status: res.status, text, truncated: candidate?.finishReason === 'MAX_TOKENS' };
}

async function callKimi(prompt: string, apiKey: string, opts: GenOptions) {
  const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxOutputTokens ?? 2000,
    }),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? '';
  return { ok: true as const, status: res.status, text, truncated: choice?.finish_reason === 'length' };
}

// Retries a given key twice on 429/503 (rate limit / overload) before giving up on it;
// any other error status moves straight to the next key.
export async function generateText(prompt: string, opts: GenOptions = {}): Promise<GenResult> {
  for (const key of geminiKeys()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callGemini(prompt, key, opts);
      if (result.ok) return { text: result.text, truncated: result.truncated, provider: 'gemini' };
      if (![429, 503].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }

  const kimiKey = Deno.env.get('KIMI_API_KEY');
  if (kimiKey) {
    const result = await callKimi(prompt, kimiKey, opts);
    if (result.ok) return { text: result.text, truncated: result.truncated, provider: 'kimi' };
  }

  throw new Error('All LLM providers exhausted or rate-limited');
}
