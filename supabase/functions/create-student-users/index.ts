import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { Resend } from 'https://esm.sh/resend@2.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Resend is optional: if RESEND_API_KEY isn't configured, accounts are still
// created — we just report emailSent:false so the college knows to hand out
// credentials another way.
const resendKey = Deno.env.get('RESEND_API_KEY')
const resend = resendKey ? new Resend(resendKey) : null

// Where Resend sends from. Override with INVITE_FROM_EMAIL once a domain is
// verified in Resend; the default only delivers to the Resend account owner.
const inviteFrom = Deno.env.get('INVITE_FROM_EMAIL') ?? 'ProofLab <onboarding@resend.dev>'

const buildInviteEmail = (opts: {
  name: string
  email: string
  password: string
  setPasswordLink: string | null
  loginUrl: string
  collegeName: string
}) => {
  const { name, email, password, setPasswordLink, loginUrl, collegeName } = opts
  const setPwButton = setPasswordLink
    ? `<p style="margin:24px 0;">
         <a href="${setPasswordLink}" style="background:#F97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">
           Set your own password
         </a>
       </p>`
    : ''
  return {
    subject: `You've been invited to ProofLab by ${collegeName} 🎓`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1a1a1a;font-size:22px;margin-bottom:16px;">Welcome, ${name}! 👋</h1>
        <p style="color:#4a4a4a;font-size:16px;line-height:1.6;">
          <strong>${collegeName}</strong> has created a ProofLab student account for you.
          You can log in right away with the credentials below.
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <p style="margin:0 0 8px;color:#111827;font-size:15px;"><strong>Email:</strong> ${email}</p>
          <p style="margin:0;color:#111827;font-size:15px;"><strong>Temporary password:</strong>
            <code style="background:#eef2ff;padding:2px 6px;border-radius:4px;">${password}</code>
          </p>
        </div>
        <p style="margin:20px 0;">
          <a href="${loginUrl}" style="background:#4F46E5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">
            Log in now
          </a>
        </p>
        ${setPwButton}
        <p style="color:#6b7280;font-size:14px;line-height:1.6;margin-top:16px;">
          For your security, please change this temporary password after your first login${setPasswordLink ? ' (or use the “Set your own password” button above)' : ''}.
        </p>
        <p style="color:#6b7280;font-size:14px;margin-top:24px;">— The ProofLab Team</p>
      </div>
    `,
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Require authenticated caller with college_admin or admin role
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
    const allowed = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'college_admin')
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get request body
    const { students, college_id, origin } = await req.json()
    const baseUrl = (typeof origin === 'string' && origin) ? origin.replace(/\/$/, '') : ''

    if (!students || !Array.isArray(students)) {
      return new Response(
        JSON.stringify({ error: 'Students array is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (!college_id) {
      return new Response(
        JSON.stringify({ error: 'College ID is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // For college_admin callers, ensure they can only create students for their own college
    const isAdmin = (roles ?? []).some((r: any) => r.role === 'admin')
    if (!isAdmin) {
      const { data: college } = await supabaseAdmin
        .from('colleges')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('id', college_id)
        .maybeSingle()
      if (!college) {
        return new Response(JSON.stringify({ error: 'Forbidden: college_id does not belong to caller' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // College name for the invite email (best-effort).
    const { data: collegeRow } = await supabaseAdmin
      .from('colleges')
      .select('name')
      .eq('id', college_id)
      .maybeSingle()
    const collegeName = collegeRow?.name || 'Your college'

    const results = []

    for (const studentData of students) {
      const { 
        name, 
        email, 
        branch, 
        year_of_study = '', 
        preferred_skills = '', 
        key_interests = '', 
        career_goals = '' 
      } = studentData

      // Convert comma-separated strings to arrays
      const convertToSkillsArray = (str: string): string[] => {
        if (!str || str.trim() === '') return []
        return str.split(',')
          .map(s => s.trim())
          .map(s => s.replace(/^["']|["']$/g, '')) // Remove surrounding quotes
          .filter(s => s.length > 0)
      }

      const preferredSkillsArray = convertToSkillsArray(preferred_skills)
      const keyInterestsArray = convertToSkillsArray(key_interests)

      try {
        // Check if auth user already exists
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingAuthUser = authUsers.users?.find(user => user.email?.toLowerCase() === email.toLowerCase())
        
        if (existingAuthUser) {
          results.push({
            email,
            status: 'duplicate',
            message: 'Auth user already exists'
          })
          continue
        }

        // Check if student profile exists
        const { data: existingProfile } = await supabaseAdmin
          .from('student_profiles')
          .select('id, user_id')
          .eq('email', email.toLowerCase())
          .maybeSingle()

        let profileNeedsAuth = false
        if (existingProfile && !existingProfile.user_id) {
          // Profile exists but has no auth user - we'll create auth and link it
          profileNeedsAuth = true
        }

        // Generate temporary password
        const tempPassword = `temp_${crypto.randomUUID().slice(0, 8)}`

        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: email.toLowerCase(),
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: name
          }
        })

        if (authError || !authData.user) {
          console.error('Auth error:', authError)
          results.push({
            email,
            status: 'error',
            message: `Auth user creation failed: ${authError?.message || 'Unknown error'}`
          })
          continue
        }

        // Assign student role
        const { error: roleError } = await supabaseAdmin
          .from('user_roles')
          .insert({
            user_id: authData.user.id,
            role: 'student',
            has_completed_wizard: true
          })

        if (roleError) {
          console.error('Role error:', roleError)
        }

        // Create student entry in students table
        const { error: studentError } = await supabaseAdmin
          .from('students')
          .insert({
            user_id: authData.user.id,
            name: name,
            email: email.toLowerCase(),
            college_id: college_id
          })

        if (studentError) {
          console.error('Students table error:', studentError)
          results.push({
            email,
            status: 'error',
            message: `Students table creation failed: ${studentError.message}`
          })
          continue
        }

        // Create or update student profile
        if (profileNeedsAuth && existingProfile) {
          // Update existing profile with new auth user
          const { error: updateError } = await supabaseAdmin
            .from('student_profiles')
            .update({
              user_id: authData.user.id,
              full_name: name,
              branch: branch || '',
              year_of_study: year_of_study || '',
              preferred_skills: preferredSkillsArray,
              key_interests: keyInterestsArray,
              career_goals: career_goals || '',
              status: 'active',
              college_id: college_id,
              source: 'College'
            })
            .eq('id', existingProfile.id)

          if (updateError) {
            console.error('Profile update error:', updateError)
            results.push({
              email,
              status: 'error',
              message: `Profile update failed: ${updateError.message}`
            })
            continue
          }
        } else if (!existingProfile) {
          // Create new student profile
          const { error: profileError } = await supabaseAdmin
            .from('student_profiles')
            .insert({
              user_id: authData.user.id,
              email: email.toLowerCase(),
              full_name: name,
              branch: branch || '',
              year_of_study: year_of_study || '',
              preferred_skills: preferredSkillsArray,
              key_interests: keyInterestsArray,
              career_goals: career_goals || '',
              total_xp: 0,
              trust_score: 0,
              status: 'active',
              college_id: college_id,
              source: 'College'
            })

          if (profileError) {
            console.error('Profile error:', profileError)
            results.push({
              email,
              status: 'error',
              message: `Profile creation failed: ${profileError.message}`
            })
            continue
          }
        }

        // Deliver the invite: temp password + a "set your own password" link.
        let emailSent = false
        let emailMessage = 'RESEND_API_KEY not configured — no invite sent'
        try {
          // Generate a set-password (recovery) link they can click instead of
          // using the temp password.
          let setPasswordLink: string | null = null
          try {
            const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
              type: 'recovery',
              email: email.toLowerCase(),
              options: baseUrl ? { redirectTo: `${baseUrl}/reset-password` } : undefined,
            })
            setPasswordLink = linkData?.properties?.action_link ?? null
          } catch (linkErr) {
            console.error('generateLink failed:', linkErr)
          }

          if (resend) {
            const loginUrl = baseUrl ? `${baseUrl}/student/login` : 'https://prooflaab.vercel.app/student/login'
            const content = buildInviteEmail({
              name, email: email.toLowerCase(), password: tempPassword,
              setPasswordLink, loginUrl, collegeName,
            })
            const sendRes = await resend.emails.send({
              from: inviteFrom,
              to: [email.toLowerCase()],
              subject: content.subject,
              html: content.html,
            })
            if (sendRes.error) {
              emailMessage = `Invite email failed: ${sendRes.error.message ?? 'unknown'}`
            } else {
              emailSent = true
              emailMessage = 'Invite email sent'
            }
          }
        } catch (mailErr) {
          console.error('Invite email error:', mailErr)
          emailMessage = `Invite email error: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`
        }

        results.push({
          email,
          status: 'success',
          message: emailSent
            ? 'Student account created and invite emailed'
            : `Student account created (${emailMessage})`,
          userId: authData.user.id,
          emailSent,
        })

      } catch (error) {
        console.error('Student processing error:', error)
        results.push({
          email,
          status: 'error',
          message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})