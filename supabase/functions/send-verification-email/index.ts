
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code }: VerificationEmailRequest = await req.json();

    console.log(`Sending verification email to: ${email}`);

    // Validate required environment variables
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = Deno.env.get("SMTP_PORT");
    const smtpUsername = Deno.env.get("SMTP_USERNAME");
    const smtpPassword = Deno.env.get("SMTP_PASSWORD");
    const smtpFromEmail = Deno.env.get("SMTP_FROM_EMAIL");

    if (!smtpHost || !smtpUsername || !smtpPassword || !smtpFromEmail) {
      console.error("Missing SMTP configuration");
      return new Response(
        JSON.stringify({ error: "SMTP configuration missing" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const port = parseInt(smtpPort || "465");
    const fromName = Deno.env.get("SMTP_FROM_NAME") || "ProofLabAI";
    
    console.log(`SMTP Config - Host: ${smtpHost}, Port: ${port}, Username: ${smtpUsername}`);

    // Create a timeout promise to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Email sending timeout")), 25000); // 25 second timeout
    });

    // Create the email sending promise
    const emailPromise = (async () => {
      const client = new SMTPClient({
        connection: {
          hostname: smtpHost,
          port: port,
          tls: port === 465, // Use SSL for port 465
          auth: {
            username: smtpUsername,
            password: smtpPassword,
          },
        },
      });

      try {
        console.log(`Attempting to send email from: ${fromName} <${smtpFromEmail}> to: ${email} via port ${port} (SSL)`);

        await client.send({
          from: `${fromName} <${smtpFromEmail}>`,
          to: email,
          subject: "Verify your ProofLabAI account",
          content: "auto",
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

        console.log("Email sent successfully");
        return { success: true };
      } finally {
        try {
          await client.close();
        } catch (closeError) {
          console.error("Error closing SMTP client:", closeError);
        }
      }
    })();

    // Race between email sending and timeout
    const result = await Promise.race([emailPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in send-verification-email function:", {
      message: error.message,
      name: error.name
    });

    // Return specific error messages
    if (error.message === "Email sending timeout") {
      return new Response(
        JSON.stringify({ 
          error: "Email sending timeout", 
          details: "The email service took too long to respond. Please try again." 
        }),
        {
          status: 408,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

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
