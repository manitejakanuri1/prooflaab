// Shared text-generation helper with multi-key + multi-provider fallback.
//
// Order: DeepSeek -> Gemini (each configured key) -> Kimi.
//
// DeepSeek is primary; Gemini and Kimi remain as fallbacks so nothing breaks
// while DEEPSEEK_API_KEY is absent or the account runs dry. Once every caller
// is confirmed working on DeepSeek the Gemini keys can simply be deleted — the
// chain skips any provider whose key is unset.
//
// NOTE: this helper is text-only. Gemini is still required for the two
// multimodal callers (resume-parser sends a PDF, resume-voice-verify sends
// audio); DeepSeek has no equivalent input, so those cannot use this helper.

interface GenOptions {
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean; // defaults true — every existing caller expects a JSON blob back
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GenResult {
  text: string;
  truncated: boolean;
  provider: 'deepseek' | 'gemini' | 'kimi';
  model: string;
  usage: TokenUsage;
}

/** Identifies who spent the tokens and on what, so usage can be attributed. */
export interface UsageContext {
  feature: string;
  userId?: string | null;
  studentId?: string | null;
}

const EMPTY_USAGE: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/** DeepSeek and Kimi both report OpenAI-shaped usage. */
function openAiUsage(data: Record<string, any>): TokenUsage {
  const u = data?.usage ?? {};
  return {
    prompt_tokens: Number(u.prompt_tokens) || 0,
    completion_tokens: Number(u.completion_tokens) || 0,
    total_tokens: Number(u.total_tokens) || 0,
  };
}

function geminiUsage(data: Record<string, any>): TokenUsage {
  const u = data?.usageMetadata ?? {};
  return {
    prompt_tokens: Number(u.promptTokenCount) || 0,
    completion_tokens: Number(u.candidatesTokenCount) || 0,
    total_tokens: Number(u.totalTokenCount) || 0,
  };
}

/**
 * Records a call against a student. Never throws: usage accounting must not be
 * able to fail the request that produced it.
 */
export async function logUsage(
  ctx: UsageContext,
  result: Pick<GenResult, 'provider' | 'model' | 'usage' | 'truncated'>,
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return;

    await fetch(`${url}/rest/v1/llm_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: ctx.userId ?? null,
        student_id: ctx.studentId ?? null,
        feature: ctx.feature,
        provider: result.provider,
        model: result.model,
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.total_tokens,
        truncated: result.truncated,
      }),
    });
  } catch (err) {
    console.error('Token usage logging failed (ignored):', err);
  }
}

async function callDeepSeek(prompt: string, apiKey: string, opts: GenOptions) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxOutputTokens ?? 2000,
      // DeepSeek honours OpenAI's json_object mode; callers all expect JSON back.
      ...(opts.json !== false ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? '';
  return { ok: true as const, status: res.status, text, truncated: choice?.finish_reason === 'length', usage: openAiUsage(data) };
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
  return { ok: true as const, status: res.status, text, truncated: candidate?.finishReason === 'MAX_TOKENS', usage: geminiUsage(data) };
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
  return { ok: true as const, status: res.status, text, truncated: choice?.finish_reason === 'length', usage: openAiUsage(data) };
}

// Retries a given key twice on 429/503 (rate limit / overload) before giving up on it;
// any other error status moves straight to the next key.
function finish(result: GenResult, track?: UsageContext): GenResult {
  // Fire and forget: the caller should not wait on accounting.
  if (track) void logUsage(track, result);
  return result;
}

export async function generateText(prompt: string, opts: GenOptions = {}, track?: UsageContext): Promise<GenResult> {
  const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (deepseekKey) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callDeepSeek(prompt, deepseekKey, opts);
      if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'deepseek', model: 'deepseek-chat', usage: result.usage ?? EMPTY_USAGE }, track);
      if (![429, 503].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }

  for (const key of geminiKeys()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callGemini(prompt, key, opts);
      if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'gemini', model: 'gemini-flash-latest', usage: result.usage ?? EMPTY_USAGE }, track);
      if (![429, 503].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }

  const kimiKey = Deno.env.get('KIMI_API_KEY');
  if (kimiKey) {
    const result = await callKimi(prompt, kimiKey, opts);
    if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'kimi', model: 'kimi-k2-0711-preview', usage: result.usage ?? EMPTY_USAGE }, track);
  }

  throw new Error('All LLM providers exhausted or rate-limited');
}
