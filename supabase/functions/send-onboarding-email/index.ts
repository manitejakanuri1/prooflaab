import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OnboardingEmailRequest {
  userType?: 'student' | 'college' | 'startup';
  user_type?: 'student' | 'college' | 'startup' | 'general';
  email: string;
  name?: string;
  user_id?: string;
}

const getEmailContent = (userType: string, name: string) => {
  const baseUrl = "https://prooflabai.com";
  
  switch (userType) {
    case 'student':
      return {
        subject: "Welcome to ProofLabAI 👋",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Hey there 👋</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Welcome to ProofLabAI! Start your first task now 👉 
              <a href="${baseUrl}/dashboard/student/tasks" style="color: #4F46E5; font-weight: 600;">
                https://prooflabai.com/dashboard/student/tasks
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              —<br>
              Team ProofLabAI
            </p>
          </div>
        `
      };
      
    case 'college':
      return {
        subject: "Welcome to ProofLabAI 👋",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome College Partner 👩‍🏫</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Upload your students here 👉 
              <a href="${baseUrl}/dashboard/college/upload" style="color: #4F46E5; font-weight: 600;">
                https://prooflabai.com/dashboard/college/upload
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              —<br>
              Team ProofLabAI
            </p>
          </div>
        `
      };
      
    case 'startup':
      return {
        subject: "Welcome to ProofLabAI 👋",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Hi Founder 🚀</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Start posting tasks here 👉 
              <a href="${baseUrl}/dashboard/startup/tasks" style="color: #4F46E5; font-weight: 600;">
                https://prooflabai.com/dashboard/startup/tasks
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              —<br>
              Team ProofLabAI
            </p>
          </div>
        `
      };
    
    case 'general':
    default:
      return {
        subject: "Welcome to ProofLabAI 👋",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome to ProofLabAI!</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Explore now 👉 
              <a href="${baseUrl}" style="color: #4F46E5; font-weight: 600;">
                https://prooflabai.com
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              —<br>
              Team ProofLabAI
            </p>
          </div>
        `
      };
  }
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userType, user_type, email, name, user_id }: OnboardingEmailRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Missing required field: email" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Determine the user type (handle both manual and automatic triggers)
    const finalUserType = userType || user_type || 'general';
    const finalName = name || email.split('@')[0];

    const emailContent = getEmailContent(finalUserType, finalName);

    const emailResponse = await resend.emails.send({
      from: "ProofLabAI <welcome@prooflabai.com>",
      to: [email],
      subject: emailContent.subject,
      html: emailContent.html,
    });

    console.log("Onboarding email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending onboarding email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);