import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { placeStudent } from "../_shared/levels.ts";
import { cors } from "../_shared/cors.ts";

/**
 * Put a student on the level map.
 *
 * Called on the first visit to the map, and again whenever they pick a new
 * track. The assessment path does not need this — resume-assessment-submit
 * places them the moment it has a verified skill list — but a student who
 * skipped the resume still has interests and picked skills, and they deserve a
 * path too rather than an empty page telling them to go take a test.
 */

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsError || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const callerId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const requestedTrack: string | undefined =
      typeof body?.track_slug === 'string' ? body.track_slug : undefined;

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id, key_interests, preferred_skills')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    // A confirmed resume is the strongest signal we have about what they can
    // actually do, so it leads. The skills they typed in the profile form come
    // second — self-reported, but better than pretending they know nothing.
    const { data: claim } = await supabase
      .from('resume_claims')
      .select('skills, projects, certifications, target_role')
      .eq('student_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const skills = [
      ...((claim?.skills as string[] | null) ?? []),
      ...((profile.preferred_skills as string[] | null) ?? []),
    ];

    const placements = await placeStudent(supabase, profile.id, {
      trackSlugs: requestedTrack ? [requestedTrack] : undefined,
      interests: (profile.key_interests as string[] | null) ?? [],
      skills,
      resume: {
        skills,
        projects: (claim?.projects as any[] | null) ?? [],
        certifications: (claim?.certifications as string[] | null) ?? [],
      },
    });

    if (placements.length === 0) {
      // Not an error: they have not told us what they are aiming at yet. The map
      // shows a track picker for this, and picking one comes straight back here.
      return json({ placements: [], needs_track: true });
    }

    return json({ placements, needs_track: false });
  } catch (error) {
    console.error('Error in levels-place:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
