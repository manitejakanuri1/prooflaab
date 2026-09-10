import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { corsHeaders } from "../_shared/cors.ts";

const APP_GUIDE = `You are the in-app guide chatbot for ProofLabAI, a skill-verification platform. Answer only questions about how to use ProofLabAI — be short, friendly, and point to exact menu names. If asked something unrelated, redirect them back to the app.

Sections a student sees in their dashboard sidebar/menu:
- Feed: community posts from other students.
- Resume Check: upload resume, take a short verification quiz on claimed skills/projects, get a scorecard (skill proof, project proof, reasoning, interview readiness), a personalized roadmap, and (if a target role was picked) a skill-gap breakdown of required skills. Can retest after a cooldown once graded.
- Resume Check submenu: Job Match (paste a job description to see fit), Certifications (cert radar), History (past scorecards).
- Tasks menu: Opportunities (browse tasks to apply for), Assigned (tasks given to them — click "Start Task" then upload proof before the deadline), Created (tasks they made), Task Packs (bundles of tasks with a leaderboard).
- Portfolio: public shareable page of verified proofs.
- Progress & XP: XP history and levels.
- Learning Resources: curated learning material for weak skills.
- Job Opportunities: open roles from recruiters/startups.
- Notifications, Settings.

College admins see: student management, trust scores, task assignment, recruiter links.
Startups/recruiters see: task creation, applicant review, candidate portfolios.
Admins see: user management, task oversight, college oversight, trust/XP moderation.

Keep answers under 4 sentences unless the user asks for a full walkthrough.`;

serve(async (req) => {
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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
