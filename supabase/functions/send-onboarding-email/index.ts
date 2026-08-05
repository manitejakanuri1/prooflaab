import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { guard } from '../_shared/rate-limit.ts';

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
  origin?: string;
}

const getEmailContent = (userType: string, name: string, origin?: string) => {
  const baseUrl = origin || "https://lovable.app";
  
  switch (userType) {
    case 'student':
      return {
        subject: "Welcome! Your Account is Ready 🎉",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome ${name}! 👋</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your student account has been successfully created! You can now start exploring tasks and building your portfolio.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              <a href="${baseUrl}/student-dashboard" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access Your Dashboard
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              Your Learning Platform Team
            </p>
          </div>
        `
      };
      
    case 'college':
    case 'college_admin':
      return {
        subject: "Welcome! College Admin Account Created 🎓",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome ${name}! 👩‍🏫</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your college administrator account has been created successfully! You can now manage students and assign tasks.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              <a href="${baseUrl}/college-dashboard" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access College Dashboard
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              Your Learning Platform Team
            </p>
          </div>
        `
      };
      
    case 'startup':
      return {
        subject: "Welcome! Startup Account Ready 🚀",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome ${name}! 🚀</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your startup account has been created successfully! You can now post tasks and connect with talented students.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              <a href="${baseUrl}/startup-dashboard" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access Startup Dashboard
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              Your Learning Platform Team
            </p>
          </div>
        `
      };
    
    case 'general':
    default:
      return {
        subject: "Welcome! Account Created Successfully 🎉",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome ${name}!</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your account has been created successfully! You can now access the platform and explore all features.
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              <a href="${baseUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Get Started
              </a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              Your Learning Platform Team
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

  // Tight cap: an unthrottled send endpoint is a way to mail arbitrary people
  // from your domain, which costs the sending reputation, not just the credits.
  const limited = await guard(req, {
    bucket: 'send-onboarding-email',
    limit: 10,
    windowSeconds: 3600,
    corsHeaders,
  });
  if (limited) return limited;

  try {
    // Require authenticated caller; only allow sending to caller's own email
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const { userType, user_type, email, name, user_id, origin }: OnboardingEmailRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Missing required field: email" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (email.toLowerCase() !== userData.user.email?.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Forbidden: email must match authenticated user" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Determine the user type (handle both manual and automatic triggers)
    const finalUserType = userType || user_type || 'general';
    const finalName = name || email.split('@')[0];

    const emailContent = getEmailContent(finalUserType, finalName, origin);

    const emailResponse = await resend.emails.send({
      from: "Learning Platform <onboarding@resend.dev>",
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