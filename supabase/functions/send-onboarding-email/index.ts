import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OnboardingEmailRequest {
  userType: 'student' | 'college' | 'startup';
  email: string;
  name: string;
}

const getEmailContent = (userType: string, name: string) => {
  const baseUrl = "https://zlfjxcwltqtajnczfjjp.supabase.co"; // Your app URL
  
  switch (userType) {
    case 'student':
      return {
        subject: "🎯 You're In! Start Your First Internship Task on ProofLabAI",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Hi ${name},</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Welcome to ProofLabAI — India's first AI-powered internship platform built for engineering students like you. 🚀
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Get real skill-based tasks</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Build a proof-of-work portfolio</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Earn XP, badges & trust score to stand out in placements</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${baseUrl}/dashboard/student/tasks" 
                 style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                Start Task
              </a>
            </div>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 20px 0;">
              Let your skills speak louder than certificates.<br>
              See you on the leaderboard!
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
        subject: "📥 Welcome to ProofLabAI – Empower Your Students with Real Internships",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Hi ${name},</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Thank you for joining ProofLabAI as a college partner. 🎓<br>
              Here's what you can do right away:
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Upload your student list (CSV)</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Assign real internship tasks (manual or AI-generated)</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Track their proof-of-work, XP, and trust score</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${baseUrl}/dashboard/college/upload" 
                 style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                Upload Students
              </a>
            </div>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 20px 0;">
              We're here to help you boost placement quality with verified, skill-based work — not fake certificates.
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
        subject: "🚀 Welcome to ProofLabAI – Find Real Intern Talent with Proof",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Hi ${name},</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Thanks for joining ProofLabAI to discover and verify student talent through real work.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Here's what you can do right away:
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Post intern tasks relevant to your project</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Review submitted proof of work</p>
              <p style="color: #2d3748; font-size: 16px; margin: 8px 0;">✅ Hire based on real effort, not resumes</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${baseUrl}/dashboard/startup/tasks" 
                 style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                Post Task
              </a>
            </div>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 20px 0;">
              Let's build India's future tech workforce — one proof at a time. 💪
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              —<br>
              Team ProofLabAI
            </p>
          </div>
        `
      };
      
    default:
      throw new Error(`Invalid user type: ${userType}`);
  }
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userType, email, name }: OnboardingEmailRequest = await req.json();

    if (!userType || !email || !name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: userType, email, name" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const emailContent = getEmailContent(userType, name);

    const emailResponse = await resend.emails.send({
      from: "ProofLabAI <onboarding@resend.dev>",
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