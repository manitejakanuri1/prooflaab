import { serve } from "../_shared/serve.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { cors } from "../_shared/cors.ts";

/**
 * Admin -> Colleges -> Add College. Same shape as create-student-users: a
 * college needs a real sign-in account, which only server-side code with the
 * service-role key can create. The client-side version of this button
 * inserted user_id: 'temp-user-id' directly — not a valid uuid, so it failed
 * every time rather than creating anyone.
 *
 * Admin-only, unlike create-student-users which a college_admin can also
 * call for their own students — a college_admin has no business creating
 * another college.
 */
serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

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
    const isAdmin = (roles ?? []).some((r: any) => r.role === 'admin')
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { name, email, status } = await req.json()
    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'name and email are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: existing } = await supabaseAdmin
      .from('colleges')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ error: 'A college with that email already exists' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tempPassword = `temp_${crypto.randomUUID().slice(0, 8)}`
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: name },
    })
    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ error: authError?.message ?? 'Could not create the account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // has_completed_wizard: true — an admin filling in name/email here has
    // already done what the onboarding wizard would otherwise ask for.
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: authData.user.id, role: 'college_admin', has_completed_wizard: true })
    if (roleError) console.error('Role error:', roleError)

    const { data: college, error: collegeError } = await supabaseAdmin
      .from('colleges')
      .insert({
        user_id: authData.user.id,
        name,
        email: email.toLowerCase(),
        status: status || 'active',
      })
      .select('id')
      .single()
    if (collegeError) {
      return new Response(JSON.stringify({ error: `Account created but college record failed: ${collegeError.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Never allowed to fail the creation — a college whose invite email
    // bounced is recoverable, a half-created account is not.
    try {
      const { data: link } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: email.toLowerCase(),
      })
      await supabaseAdmin.functions.invoke('send-onboarding-email', {
        body: { email, name, userType: 'college', actionLink: link?.properties?.action_link ?? null },
      })
    } catch (inviteError) {
      console.error('Invitation email failed (college was still created):', inviteError)
    }

    return new Response(
      JSON.stringify({ id: college.id, userId: authData.user.id, status: 'success' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('create-college-user error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
