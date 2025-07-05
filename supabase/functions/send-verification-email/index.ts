
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code }: VerificationEmailRequest = await req.json();

    console.log(`Sending verification email to: ${email}`);

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

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: port,
        tls: port === 465,
        auth: {
          username: smtpUsername,
          password: smtpPassword,
        },
      },
    });

    console.log(`Sending email from: ${fromName} <${smtpFromEmail}> to: ${email}`);

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

    await client.close();
    console.log("Email sent successfully");

    return new Response(JSON.stringify({ success: true }), {
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
