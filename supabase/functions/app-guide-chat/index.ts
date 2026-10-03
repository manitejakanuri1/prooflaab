import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

const APP_GUIDE = `You are the in-app guide chatbot for ProofLabAI, a place where engineering students do real work and build proof of their skills. Answer only questions about how to use ProofLabAI - be short, friendly, and use the exact menu names below. If asked something unrelated, bring them back to the app. Never tell anyone to upload a file or a proof: all work is done inside the app.

A student has four areas in the menu:
- Daily Card: today's Lot - one real piece of work. Open it, read the task (a simple-words version is shown first), do it in the code editor (Run tries your code on the examples; Submit checks it against every test) or type your answer in the answer box, then Submit. After submitting, record a short spoken explanation of how you did it. Other open tasks are listed under it.
- Build-Log: your record of work - submissions, scores, feedback and voice explanations, plus progress and badges.
- Squad: your team in your college, its matches and points.
- Profile: your resume check (upload your resume, confirm your skills, take the short timed quiz and coding round, see your scorecard and roadmap), learning roadmap and tracks, settings.

A college (TPO) sees Home, Students, Squads and Insights: who is active, who needs help, squad standings, and student imports.
A company/recruiter sees Home, Talent (search and shortlist), Work (post or sponsor tasks and see submissions) and Jobs.
An admin manages users, colleges, companies, tasks and platform health.

Keep answers under 4 sentences unless the user asks for a full walkthrough.`;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { message, history } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
    const transcript = recentHistory
      .map((h: { role: string; text: string }) => `${h.role === 'user' ? 'Student' : 'Guide'}: ${h.text}`)
      .join('\n');

    const prompt = `${APP_GUIDE}

${transcript ? `Conversation so far:\n${transcript}\n` : ''}
Student: ${message}
Guide: Reply with plain text only, no JSON, no markdown fences.`;

    // Cached: this answers questions about how the app works, and "where do I
    // upload my resume" has one right answer no matter who asks it. The second
    // student to ask gets the same reply for free.
    const result = await generateText(prompt, { temperature: 0.4, maxOutputTokens: 300, json: false, cache: true }, { feature: 'app-guide-chat' });

    return new Response(
      JSON.stringify({ reply: result.text.trim() }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in app-guide-chat:', error);
    // Over-budget callers get a 429 with Retry-After, not a generic failure,
    // so the client can tell 'wait' apart from 'broken'.
    const limited = rateLimitResponse(error, corsHeaders);
    if (limited) return limited;
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
