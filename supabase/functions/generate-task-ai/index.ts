import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "../_shared/serve.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { generateText } from "../_shared/llm.ts";
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { prompt } = await req.json();

    console.log('Generating AI task with prompt:', prompt);

    // json: false — the reply is parsed as "Title:/Description:" prose, not JSON.
    const { text: generatedText, provider } = await generateText(
      `You are a learning task generator. Based on the user's input, create a single learning task with the following format:

Title: [Create a concise, engaging task title]
Description: [Write a detailed 3-5 sentence description explaining what the student will learn, what they need to do, and why it's valuable for their growth]

User's learning goal: ${prompt}

Keep the title under 100 characters and the description focused and actionable.`,
      { temperature: 0.7, maxOutputTokens: 500, json: false }
    , { feature: 'generate-task-ai' });

    console.log(`Task generated via ${provider}`);

    // Parse the response
    const titleMatch = generatedText.match(/Title:\s*(.+?)(?:\n|$)/i);
    const descriptionMatch = generatedText.match(/Description:\s*(.+?)$/is);

    const title = titleMatch?.[1]?.trim() || 'Learning Task';
    const description = descriptionMatch?.[1]?.trim() || generatedText;

    return new Response(
      JSON.stringify({ title, description }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-task-ai function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});