import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { corsHeaders } from "../_shared/cors.ts";

// LeetCode has no official public API. This is their site's own GraphQL
// endpoint (used by leetcode.com itself), queried read-only for a public
// profile's calendar. No auth token of ours involved — undocumented and can
// break if LeetCode changes their schema.
const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

const CALENDAR_QUERY = `
  query userProfileCalendar($username: String!) {
    matchedUser(username: $username) {
      userCalendar {
        streak
        submissionCalendar
      }
    }
  }
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = claims.claims.sub;

    const { username } = await req.json();
    if (!username || typeof username !== 'string') {
      return new Response(JSON.stringify({ error: 'username is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Student profile not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lcRes = await fetch(LEETCODE_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: CALENDAR_QUERY, variables: { username } }),
    });

    if (!lcRes.ok) {
      return new Response(JSON.stringify({ error: 'LeetCode lookup failed' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lcJson = await lcRes.json();
    const calendar = lcJson?.data?.matchedUser?.userCalendar;
    if (!calendar) {
      return new Response(JSON.stringify({ error: `No LeetCode user found for "${username}"` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const currentStreak: number = calendar.streak ?? 0;
    const submissionCalendar: Record<string, number> = JSON.parse(calendar.submissionCalendar || '{}');
    const activeDays = Object.entries(submissionCalendar)
      .filter(([, count]) => count > 0)
      .map(([unixDay]) => Number(unixDay));
    const lastActiveUnix = activeDays.length > 0 ? Math.max(...activeDays) : null;
    const lastActiveDate = lastActiveUnix ? new Date(lastActiveUnix * 1000).toISOString().slice(0, 10) : null;

    const { data: existing } = await supabase
      .from('coding_streaks')
      .select('longest_streak')
      .eq('student_id', profile.id)
      .eq('platform', 'leetcode')
      .maybeSingle();

    const longestStreak = Math.max(currentStreak, existing?.longest_streak ?? 0);

    const { data: row, error: upsertError } = await supabase
      .from('coding_streaks')
      .upsert({
        student_id: profile.id,
        platform: 'leetcode',
        username,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        last_active_date: lastActiveDate,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'student_id,platform' })
      .select()
      .single();

    if (upsertError || !row) {
      console.error('Error saving leetcode streak:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to save streak' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, streak: row }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in leetcode-streak-sync:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
