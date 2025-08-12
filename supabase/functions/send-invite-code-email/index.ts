import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteCodeEmailRequest {
  email: string;
  inviteCode: string;
  accountType: 'college' | 'startup';
  name?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, inviteCode, accountType, name }: InviteCodeEmailRequest = await req.json();
    
    console.log(`Processing invite code email for: ${email}, type: ${accountType}`);

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

    const resend = new Resend(resendApiKey);

    const accountTypeDisplay = accountType === 'college' ? 'College' : 'Startup';
    const userName = name || email.split('@')[0];

    const emailResponse = await resend.emails.send({
      from: "ProofLabAI <noreply@prooflabai.com>",
      to: [email],
      subject: `Your ProofLabAI ${accountTypeDisplay} Invite Code`,
      text: `Hello ${userName},

Thank you for signing up for ProofLabAI as a ${accountTypeDisplay}!

Your invite code is: ${inviteCode}

Please use this code to complete your registration and gain access to your ${accountTypeDisplay} dashboard.

Next steps:
1. Complete your email verification
2. Enter this invite code when prompted
3. Start using ProofLabAI!

If you have any questions, please don't hesitate to contact our support team.

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
          <title>Your ProofLabAI Invite Code</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9fafb;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="padding: 40px 30px; text-align: center;">
                      <h1 style="color: #1e40af; font-size: 28px; margin: 0 0 20px 0; font-weight: bold;">
                        Welcome to ProofLabAI! 🎉
                      </h1>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Hello ${userName},
                      </p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Thank you for signing up for ProofLabAI as a <strong>${accountTypeDisplay}</strong>!
                      </p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                        Your invite code is:
                      </p>
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="padding: 20px; background-color: #f3f4f6; border-radius: 8px; margin: 20px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; font-family: 'Courier New', monospace;">
                              ${inviteCode}
                            </span>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 20px 0;">
                        Please use this code to complete your registration and gain access to your ${accountTypeDisplay} dashboard.
                      </p>
                      <div style="text-align: left; margin: 30px 0; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
                        <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">Next steps:</h3>
                        <ol style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0; padding-left: 20px;">
                          <li>Complete your email verification</li>
                          <li>Enter this invite code when prompted</li>
                          <li>Start using ProofLabAI!</li>
                        </ol>
                      </div>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 20px 0 0 0;">
                        If you have any questions, please don't hesitate to contact our support team.
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

    console.log("Invite code email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Invite code email sent successfully",
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
    console.error("Error in send-invite-code-email function:", error);

    return new Response(
      JSON.stringify({ 
        error: "Failed to send invite code email", 
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