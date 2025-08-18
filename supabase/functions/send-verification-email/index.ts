
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
      console.error("Available env vars:", Object.keys(Deno.env.toObject()));
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
      subject: "ProofLabAI Account Verification Code",
      text: `Welcome to ProofLabAI!

Thank you for signing up for ProofLabAI - the Real Proof-of-Work Internship Platform for Engineering Students.

Your verification code is: ${code}

Please enter this code to complete your registration. This code will expire in 10 minutes.

If you didn't create an account with ProofLabAI, please ignore this email.

Best regards,
The ProofLabAI Team

--
ProofLabAI
Real Proof-of-Work Internship Platform
https://prooflabai.com`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>ProofLabAI Account Verification</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9fafb;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="padding: 40px 30px; text-align: center;">
                      <h1 style="color: #1e40af; font-size: 28px; margin: 0 0 20px 0; font-weight: bold;">
                        Welcome to ProofLabAI! 👨‍💻
                      </h1>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Thank you for signing up for ProofLabAI - the Real Proof-of-Work Internship Platform for Engineering Students.
                      </p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                        Please use the verification code below to complete your registration:
                      </p>
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="padding: 20px; background-color: #f3f4f6; border-radius: 8px; margin: 20px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; font-family: 'Courier New', monospace;">
                              ${code}
                            </span>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 20px 0 0 0;">
                        This code will expire in 10 minutes for security purposes.
                      </p>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 10px 0 0 0;">
                        If you didn't create an account with ProofLabAI, please ignore this email.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 20px 30px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                      <p style="color: #6b7280; font-size: 12px; margin: 0;">
                        Best regards,<br>
                        The ProofLabAI Team<br>
                        <a href="https://prooflabai.com" style="color: #1e40af; text-decoration: none;">prooflabai.com</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
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
      } else if (emailResponse.error.message?.includes("not verified")) {
        userFriendlyMessage = "The sender email domain is not verified. Please verify your domain at resend.com/domains.";
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
