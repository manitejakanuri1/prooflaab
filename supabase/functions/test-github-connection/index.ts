import { serve } from "../_shared/serve.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated admin caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id);
    if (!(roles ?? []).some((r: any) => r.role === 'admin')) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const GITHUB_PAT = Deno.env.get('GITHUB_PAT');
    
    if (!GITHUB_PAT) {
      console.error('GITHUB_PAT environment variable is not set');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'GITHUB_PAT not configured' 
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Testing GitHub connection...');

    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ProofLabAI-Verification'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitHub API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `GitHub API error: ${response.status}`,
          details: errorText
        }),
        { 
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Named apart from the userData holding the Supabase caller above. Two
    // `const userData` in one scope is a SyntaxError, so the module never
    // parsed and this function was dead rather than merely wrong.
    const githubUser = await response.json();

    // Get OAuth scopes from response headers
    const scopes = response.headers.get('X-OAuth-Scopes') || 'unknown';

    console.log('GitHub connection successful:', githubUser.login);

    return new Response(
      JSON.stringify({
        success: true,
        username: githubUser.login,
        name: githubUser.name,
        scopes: scopes,
        message: 'GitHub token is valid and working'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error testing GitHub connection:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
