import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate webhook secret for scheduled/cron calls
    const webhookSecret = req.headers.get('x-webhook-secret');
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET');

    if (!expectedSecret) {
      console.error('WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!webhookSecret || webhookSecret !== expectedSecret) {
      console.error('Invalid or missing webhook secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Running daily credit reset...');

    // Call the database function to reset credits
    const { error } = await supabase.rpc('reset_daily_credits');

    if (error) {
      console.error('Error resetting credits:', error);
      throw error;
    }

    console.log('Credits reset successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Credits reset successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in reset-daily-credits function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
