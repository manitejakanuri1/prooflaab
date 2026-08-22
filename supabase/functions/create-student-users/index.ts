import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { students, college_id } = await req.json()
    
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

    const results = []

    for (const studentData of students) {
      const { 
        name, 
        email, 
        branch, 
        year_of_study = '', 
        preferred_skills = '', 
        key_interests = '', 
        career_goals = '',
        // How a college actually names a student. Unique per college, so two
        // colleges may both legitimately have a 23CSE041.
        roll_number = '',
        batch = ''
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

        // Check if student profile exists. The email moved to student_contact
        // so that a signed-in student cannot read every other student's
        // address off the directory, so the lookup starts there.
        const { data: existingContact } = await supabaseAdmin
          .from('student_contact')
          .select('student_id')
          .ilike('email', email.toLowerCase())
          .maybeSingle()

        const { data: existingProfile } = existingContact
          ? await supabaseAdmin
              .from('student_profiles')
              .select('id, user_id')
              .eq('id', existingContact.student_id)
              .maybeSingle()
          : { data: null }

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

        // The `students` insert that used to sit here has been removed. It
        // wrote a second copy of name/email/college that nothing ever read
        // back, and a failure on it aborted the whole record even though the
        // student_profiles write below is the one that matters.

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
              source: 'College',
              roll_number: roll_number || null,
              batch: batch || null,
              // Imported, not yet arrived: the student still has to sign in and
              // finish. Home counts these as needing attention until they do.
              onboarding_status: 'invited',
              invited_at: new Date().toISOString()
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
          const { data: newProfile, error: profileError } = await supabaseAdmin
            .from('student_profiles')
            .insert({
              user_id: authData.user.id,
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
              source: 'College',
              roll_number: roll_number || null,
              batch: batch || null,
              onboarding_status: 'invited',
              invited_at: new Date().toISOString()
            })
            .select('id')
            .single()

          if (profileError) {
            console.error('Profile error:', profileError)
            results.push({
              email,
              status: 'error',
              message: `Profile creation failed: ${profileError.message}`
            })
            continue
          }

          // A trigger already copies the address across from the auth account;
          // this makes sure it matches the one the college supplied.
          const { error: contactError } = await supabaseAdmin
            .from('student_contact')
            .upsert(
              { student_id: newProfile.id, email: email.toLowerCase() },
              { onConflict: 'student_id' }
            )

          if (contactError) {
            console.error('Contact error:', contactError)
          }
        }

        // The invitation. §6: after a successful import the platform invites the
        // students it just created — until now the import created accounts and
        // told nobody, so every imported student sat waiting for an email that
        // was never sent.
        //
        // A recovery link rather than the temporary password: the password is
        // generated here and should die here. Mailing it would put a working
        // credential in an inbox forever.
        //
        // Never allowed to fail the import. A student whose account exists but
        // whose email bounced is recoverable; a half-finished import is not.
        try {
          const { data: link } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email,
          })

          await supabaseAdmin.functions.invoke('send-onboarding-email', {
            body: {
              email,
              name,
              userType: 'student',
              actionLink: link?.properties?.action_link ?? null,
            },
          })
        } catch (inviteError) {
          console.error('Invitation email failed (student was still created):', inviteError)
        }

        results.push({
          email,
          status: 'success',
          message: 'Student account created and invited',
          userId: authData.user.id
          // Temporary password intentionally omitted from the response: the
          // student sets their own through the link above.
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