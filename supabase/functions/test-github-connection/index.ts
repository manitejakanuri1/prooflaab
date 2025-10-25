import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const userData = await response.json();
    
    // Get OAuth scopes from response headers
    const scopes = response.headers.get('X-OAuth-Scopes') || 'unknown';
    
    console.log('GitHub connection successful:', userData.login);

    return new Response(
      JSON.stringify({ 
        success: true,
        username: userData.login,
        name: userData.name,
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
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
