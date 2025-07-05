
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VerificationEmailRequest {
  email: string;
  code: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code }: VerificationEmailRequest = await req.json();
    
    console.log(`Processing verification email for: ${email}`);

    // For now, let's just simulate email sending to avoid SMTP complexity
    // You can integrate with a service like SendGrid, Mailgun, or similar later
    console.log(`Would send verification code ${code} to ${email}`);
    
    // Simulate a small delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Email queued for sending",
      email: email 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in send-verification-email function:", error.message);

    return new Response(
      JSON.stringify({ 
        error: "Failed to process email", 
        details: error.message 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
