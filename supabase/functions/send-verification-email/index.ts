
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

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

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not configured");
      return new Response(
        JSON.stringify({ 
          error: "Email service not configured", 
          details: "Missing API key" 
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Resend API key found, initializing Resend client");
    const resend = new Resend(resendApiKey);

    console.log("Attempting to send email via Resend...");
    const emailResponse = await resend.emails.send({
      from: "ProofLabAI <onboarding@resend.dev>",
      to: [email],
      subject: "Verify your ProofLabAI account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Welcome to ProofLabAI! 👨‍💻</h2>
          <p>Thank you for signing up! Please use the verification code below to complete your registration:</p>
          <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="color: #1e40af; font-size: 32px; margin: 0; letter-spacing: 4px;">${code}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't create an account with ProofLabAI, please ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 14px;">
            Best regards,<br>
            The ProofLabAI Team
          </p>
        </div>
      `,
    });

    console.log("Email API response:", JSON.stringify(emailResponse, null, 2));

    // Check if the email was actually sent successfully
    if (emailResponse.error) {
      console.error("Resend API error:", emailResponse.error);
      
      // Handle specific Resend errors
      let userFriendlyMessage = "Email sending failed";
      if (emailResponse.error.message?.includes("can only send testing emails")) {
        userFriendlyMessage = "Email verification is in testing mode. Please verify your domain at resend.com/domains or contact support.";
      }
      
      return new Response(
        JSON.stringify({ 
          error: userFriendlyMessage, 
          details: emailResponse.error 
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Email sent successfully with ID:", emailResponse.data?.id);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Verification email sent successfully",
      email: email,
      emailId: emailResponse.data?.id
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in send-verification-email function:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    return new Response(
      JSON.stringify({ 
        error: "Failed to send email", 
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
