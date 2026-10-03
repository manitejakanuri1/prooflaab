import { serve } from "../_shared/serve.ts";
import { secretMatches } from "../_shared/secret.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "../_shared/backend.ts";
import { guard } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

/**
 * Built per request, not once at module load.
 *
 * RESEND_API_KEY is not configured, and constructing the client at the top level
 * threw while the module was still loading — so the function never started and
 * every request died with it, including the CORS preflight. A browser that
 * cannot complete OPTIONS reports a CORS failure, which points at the wrong
 * thing entirely and hides a missing environment variable behind it.
 */
function getResend(): Resend | null {
  const key = Deno.env.get("RESEND_API_KEY");
  return key ? new Resend(key) : null;
}

interface OnboardingEmailRequest {
  userType?: 'student' | 'college' | 'startup';
  user_type?: 'student' | 'college' | 'startup' | 'general';
  email: string;
  name?: string;
  user_id?: string;
  origin?: string;
  /** Set-password link, accepted only from internal callers (the import). */
  actionLink?: string | null;
}

const getEmailContent = (userType: string, name: string, origin?: string, setPasswordLink?: string | null) => {
  // Always our own site. The link used to default to prooflaab.vercel.app -
  // deleted with Vercel - and to take `origin` from the request body, which
  // let a caller put any address they liked behind the button. And
  // /student-dashboard never existed. Everyone lands on sign-in; the app sends
  // each role to its own dashboard from there.
  void origin;
  const baseUrl = Deno.env.get("SITE_URL") ?? "https://prooflab.co.in";
  
  switch (userType) {
    case 'student':
      return {
        subject: "Welcome! Your Account is Ready 🎉",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 20px;">Welcome ${name}! 👋</h1>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your college has added you to ProofLab. ${setPasswordLink ? 'Set your password to sign in for the first time:' : 'You can now start exploring tasks and building your portfolio.'}
            </p>
            
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              <a href="${setPasswordLink ?? `${baseUrl}/auth`}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                ${setPasswordLink ? 'Set your password' : 'Access Your Dashboard'}
              </a>
            </p>
            ${setPasswordLink ? `
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
              After that, sign in any time at <a href="${baseUrl}/auth">${baseUrl.replace('https://', '')}/auth</a>.
              The button works for about an hour; if it has expired, use <b>Forgot password</b> on the sign-in page.
            </p>` : ''}
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Best regards,<br>
              The ProofLab team
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
              <a href="${baseUrl}/auth" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
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
              <a href="${baseUrl}/auth" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
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
              <a href="${baseUrl}/auth" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
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
  const corsHeaders = cors(req);
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // A function inviting the students it just created - create-student-users,
  // create-college-user - proves itself with the webhook secret, as
  // the scheduled jobs do. It is not a signed-in
  // user, so the "your own address only" rule below cannot apply to it, and it
  // is not a stranger, so the per-caller rate limit must not either: every
  // internal call arrives from the same loopback address, and an import of
  // sixty students would otherwise send ten welcome emails and drop fifty.
  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  const internal = secretMatches(req.headers.get("x-webhook-secret"), expectedSecret);

  // Tight cap: an unthrottled send endpoint is a way to mail arbitrary people
  // from your domain, which costs the sending reputation, not just the credits.
  const limited = internal ? null : await guard(req, {
    bucket: 'send-onboarding-email',
    limit: 10,
    windowSeconds: 3600,
    corsHeaders,
  });
  if (limited) return limited;

  try {
    // Require authenticated caller; only allow sending to caller's own email
    const authHeader = req.headers.get("Authorization");
    if (!internal && !authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: userData, error: userErr } = internal
      ? { data: null, error: null }
      : await supabase.auth.getUser(authHeader!.replace("Bearer ", ""));
    if (!internal && (userErr || !userData?.user)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const { userType, user_type, email, name, user_id, origin, actionLink }: OnboardingEmailRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Missing required field: email" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!internal && email.toLowerCase() !== userData?.user?.email?.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Forbidden: email must match authenticated user" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Determine the user type (handle both manual and automatic triggers)
    const finalUserType = userType || user_type || 'general';
    const finalName = name || email.split('@')[0];

    // Only the import (an internal caller) may put a link in the email, and only
    // an https one - a signed-in user must not be able to mail themselves any
    // address they like behind the button.
    const setPasswordLink = internal && typeof actionLink === 'string' && actionLink.startsWith('https://')
      ? actionLink : null;
    const emailContent = getEmailContent(finalUserType, finalName, origin, setPasswordLink);

    const resend = getResend();
    if (!resend) {
      // Signup already succeeded by the time this runs, so a missing key must
      // not read as a failed signup. Reported plainly and logged loudly.
      console.error('RESEND_API_KEY is not configured — onboarding email skipped');
      return new Response(
        JSON.stringify({ success: false, skipped: true, error: 'Email sending is not configured' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // resend.dev is Resend's test sender: it delivers only to the Resend account's
    // own address. Real students need a verified domain, set as EMAIL_FROM
    // (e.g. "ProofLabAI <hello@prooflab.co.in>") once prooflab.co.in is verified.
    const emailResponse = await resend.emails.send({
      from: Deno.env.get("EMAIL_FROM") ?? "Learning Platform <onboarding@resend.dev>",
      to: [email],
      subject: emailContent.subject,
      html: emailContent.html,
    });

    // Resend reports a refused send in the body, not by throwing. This used to
    // log "sent successfully" and answer success:true for every refusal.
    if (emailResponse.error) {
      console.error("Onboarding email refused by Resend:", emailResponse.error);
      return new Response(
        JSON.stringify({ success: false, error: emailResponse.error.message }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

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
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);