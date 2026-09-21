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

import { checkRateLimit, RateLimitError } from './rate-limit.ts';
import { logSecurityEvent } from './audit.ts';
import { als } from './log.ts';

interface GenOptions {
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean; // defaults true — every existing caller expects a JSON blob back
  /** Opt out of the shared cap. For internal batch work only. */
  skipRateLimit?: boolean;
  /**
   * Serve an identical earlier prompt from the cache instead of paying again.
   *
   * Opt-in per call site, never global. Only for questions with one right answer
   * for a given input — which certificates suit a role, whether a skill set
   * covers an interest. Anything that is meant to differ between students, above
   * all generated questions, must leave this off or everybody sits the same test.
   */
  cache?: boolean;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GenResult {
  text: string;
  truncated: boolean;
  /** 'cache' means no provider was contacted and nothing was spent. */
  provider: 'deepseek' | 'gemini' | 'kimi' | 'cache';
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
        request_id: als.getStore()?.request_id ?? null,
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
function finish(result: GenResult, track?: UsageContext, cacheHash?: string | null): GenResult {
  // Logged unconditionally: every model call must be accounted for, even from a
  // caller that forgot to identify itself. Such calls land under 'unattributed'
  // rather than vanishing. Fire and forget - the caller never waits on this.
  void logUsage(track ?? { feature: 'unattributed' }, result);
  // Only a whole answer is worth keeping. Caching a truncated one would serve
  // the same broken JSON to every later caller instead of just this one.
  if (cacheHash && !result.truncated && result.text.trim()) {
    void writeCache(cacheHash, track?.feature ?? 'unattributed', result);
  }
  return result;
}

const RATE_WINDOW_SECONDS = 3600;

/**
 * One shared allowance per signed-in caller across every AI feature.
 *
 * Deliberately not per feature: a per-feature cap of 30 across eighteen
 * features is a 540/hour cap, which is not a cap. What needs protecting is the
 * provider bill, and the bill does not care which feature spent it.
 */
const PER_USER_HOURLY = 60;

/**
 * Ceiling for calls that arrive without a user — cron runs, webhook-authorised
 * internal calls, and any caller that forgot to identify itself. Per feature,
 * and generous, because legitimate batch work lives here; it exists to stop a
 * runaway loop, not to pace normal use.
 */
const ANON_HOURLY: Record<string, number> = {
  'app-guide-chat': 200,
  'unattributed': 200,
};
const ANON_HOURLY_DEFAULT = 500;

/**
 * Refuses the call before any provider is contacted when the caller is over
 * budget. Placed here rather than in each function so a new AI feature is
 * covered the moment it calls generateText.
 */
async function enforceLlmRateLimit(track?: UsageContext): Promise<void> {
  const identity = track?.userId ?? track?.studentId ?? null;
  const feature = track?.feature ?? 'unattributed';

  const [bucket, subject, limit] = identity
    ? ['llm:user', `user:${identity}`, PER_USER_HOURLY]
    : ['llm:anon', `feature:${feature}`, ANON_HOURLY[feature] ?? ANON_HOURLY_DEFAULT];

  const decision = await checkRateLimit(bucket, subject, limit, RATE_WINDOW_SECONDS);
  if (!decision.allowed) {
    console.warn(`Rate limit hit: ${bucket}/${subject} (${decision.hits}/${limit})`);
    // No Request object reaches this far down, so the IP is not recorded here;
    // the identity that matters for AI spend is the user, and that is.
    logSecurityEvent(null, {
      eventType: 'ai_rate_limited',
      severity: 'warning',
      userId: track?.userId ?? null,
      detail: { feature, bucket, hits: decision.hits, limit },
    });
    throw new RateLimitError(
      identity
        ? 'You have used a lot of AI features in the last hour. Please try again shortly.'
        : 'This feature is busy right now. Please try again shortly.',
      decision.retry_after,
      limit,
    );
  }
}

/** Supabase REST helper for the cache table. Kept local so llm.ts pulls in no client. */
async function cacheRest(path: string, init: RequestInit): Promise<Response | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  return await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Identity of a prompt for caching. The options change the answer, so they are in the key. */
async function promptHash(prompt: string, opts: GenOptions): Promise<string> {
  const shape = `${opts.temperature ?? 0.5}|${opts.maxOutputTokens ?? 2000}|${opts.json !== false}`;
  const data = new TextEncoder().encode(`${shape}\n${prompt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A previous answer to this exact prompt, if there is one.
 *
 * Never throws: a cache that is down must slow nothing and break nothing, it
 * should simply stop saving money until it comes back.
 */
async function readCache(hash: string): Promise<{ response: string; model: string } | null> {
  try {
    const res = await cacheRest(`llm_cache?prompt_hash=eq.${hash}&select=response,model`, {
      method: 'GET',
    });
    if (!res?.ok) return null;
    const rows = await res.json();
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  hash: string,
  feature: string,
  result: GenResult,
): Promise<void> {
  try {
    await cacheRest('llm_cache?on_conflict=prompt_hash', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        prompt_hash: hash,
        feature,
        response: result.text,
        model: result.model,
        saved_tokens: result.usage.total_tokens,
      }),
    });
  } catch (err) {
    console.error('LLM cache write failed (ignored):', err);
  }
}

async function recordCacheHit(hash: string): Promise<void> {
  try {
    await cacheRest(`rpc/bump_llm_cache_hit`, {
      method: 'POST',
      body: JSON.stringify({ p_hash: hash }),
    });
  } catch {
    // Hit counting is bookkeeping; losing it must not affect the answer.
  }
}

export async function generateText(prompt: string, opts: GenOptions = {}, track?: UsageContext): Promise<GenResult> {
  // Checked before the rate limit as well as before the providers: a cached
  // answer costs nothing, so it should not consume anybody's hourly allowance.
  let hash: string | null = null;
  if (opts.cache) {
    hash = await promptHash(prompt, opts);
    const cached = await readCache(hash);
    if (cached) {
      void recordCacheHit(hash);
      const result: GenResult = {
        text: cached.response,
        truncated: false,
        provider: 'cache',
        model: cached.model,
        usage: EMPTY_USAGE,
      };
      // Logged with zero tokens so a saving is visible next to the spend it
      // replaced, rather than the call simply vanishing from the ledger.
      void logUsage(track ?? { feature: 'unattributed' }, result);
      return result;
    }
  }

  if (!opts.skipRateLimit) await enforceLlmRateLimit(track);

  const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (deepseekKey) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callDeepSeek(prompt, deepseekKey, opts);
      if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'deepseek', model: 'deepseek-chat', usage: result.usage ?? EMPTY_USAGE }, track, hash);
      if (![429, 503].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }

  for (const key of geminiKeys()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callGemini(prompt, key, opts);
      if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'gemini', model: 'gemini-flash-latest', usage: result.usage ?? EMPTY_USAGE }, track, hash);
      if (![429, 503].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }

  const kimiKey = Deno.env.get('KIMI_API_KEY');
  if (kimiKey) {
    const result = await callKimi(prompt, kimiKey, opts);
    if (result.ok) return finish({ text: result.text, truncated: result.truncated, provider: 'kimi', model: 'kimi-k2-0711-preview', usage: result.usage ?? EMPTY_USAGE }, track, hash);
  }

  throw new Error('All LLM providers exhausted or rate-limited');
}
