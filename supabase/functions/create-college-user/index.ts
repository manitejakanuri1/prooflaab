import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { deliverManagedInvite } from "../_shared/managedInvite.ts";

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

    // Role + college row are one database transaction. If either cannot be
    // written, nothing is kept and the fresh Identity login is rolled back.
    const { data: collegeId, error: provisionError } =
      await supabaseAdmin.rpc('provision_college_account', {
        _user_id: authData.user.id,
        _created_by: userData.user.id,
        _name: name,
        _email: email.toLowerCase(),
        _status: status || 'active',
      })

    if (provisionError || !collegeId) {
      console.error(
        'College provisioning failed:',
        provisionError,
      )

      const { error: rollbackError } =
        await supabaseAdmin.auth.admin.deleteUser(
          authData.user.id,
        )

      if (rollbackError) {
        console.error(
          'College login rollback failed:',
          rollbackError,
        )
      }

      return new Response(
        JSON.stringify({
          error: rollbackError
            ? 'College provisioning failed and automatic login rollback also failed. Administrator review is required.'
            : 'College provisioning failed. The login was rolled back; please try again.'
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }

    // Invitation delivery is separate from account creation: creation stays
    // successful, but the response must tell the UI the truth about delivery.
    const invite = await deliverManagedInvite(
      () =>
        supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: email.toLowerCase(),
        }),
      (actionLink) =>
        supabaseAdmin.functions.invoke(
          'send-onboarding-email',
          {
            headers: {
              'x-webhook-secret':
                Deno.env.get('WEBHOOK_SECRET') ?? '',
            },
            body: {
              email,
              name,
              userType: 'college',
              actionLink,
            },
          },
        ),
      Deno.env.get('BACKEND') === 'google',
    )

    if (!invite.invited) {
      console.error(
        'college account created but invitation delivery was not confirmed',
      )
    }

    return new Response(
      JSON.stringify({
        id: collegeId,
        userId: authData.user.id,
        status: 'success',
        invited: invite.invited,
        inviteDelivery: invite.delivery,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    console.error('create-college-user error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
