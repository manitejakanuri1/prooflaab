import { serve } from "../_shared/serve.ts";
import { createClient, findAccountByEmail } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);
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
        batch = '',
        // §6 lists phone as a required CSV column. The importer normalises it
        // to ten digits before it gets here, or sends an empty string.
        phone = ''
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
        // Does this email already have an account? Asked of whichever backend is
        // in use - the database on Google, the account list on Supabase.
        let existingAuthUser = await findAccountByEmail(supabaseAdmin, email)

        // An empty account (no role, no student/college/company record, no work)
        // is a leftover from an earlier sign-in or removal, not a real person
        // on the platform. Clear it and create the student normally - skipping
        // them is what made "21 of 22 added" on 18 Sep.
        if (existingAuthUser) {
          const { data: freed } = await supabaseAdmin.rpc('drop_empty_account', { _id: existingAuthUser.id })
          if (freed === true) existingAuthUser = null
        }
        
        // An account with this email already exists. That is the ordinary case,
        // not an error: the keenest students sign up on their own before their
        // college ever uploads a CSV, and they are exactly the ones the college
        // most wants to see. Skipping them left them orphaned — able to work,
        // invisible to their college, never in a squad, and reported to the
        // TPO as a "duplicate" they reasonably assumed was already handled.
        //
        // Three outcomes, and only one of them changes anything:
        //   no college yet          -> link them, keep every bit of their work
        //   already at this college -> nothing to do, say so
        //   at a different college  -> refuse. A college must never be able to
        //                              pull another college's students onto its
        //                              dashboard by putting their emails in a file.
        if (existingAuthUser) {
          const { data: theirProfile } = await supabaseAdmin
            .from('student_profiles')
            .select('id, college_id, full_name, roll_number, branch, batch')
            .eq('user_id', existingAuthUser.id)
            .maybeSingle()

          if (!theirProfile) {
            results.push({
              email,
              status: 'duplicate',
              message: 'This email is already used by an admin, college or company login, so it cannot also be a student'
            })
            continue
          }

          if (theirProfile.college_id && theirProfile.college_id !== college_id) {
            const { data: other } = await supabaseAdmin
              .from('colleges')
              .select('name')
              .eq('id', theirProfile.college_id)
              .maybeSingle()
            results.push({
              email,
              status: 'other_college',
              message: `Already a student at ${other?.name ?? 'another college'} — not changed`
            })
            continue
          }

          if (theirProfile.college_id === college_id) {
            results.push({
              email,
              status: 'already_yours',
              message: 'Already in your college'
            })
            continue
          }

          // The link. Their name, XP, roadmap, build-log and history are left
          // exactly as they are; only the college's own fields are filled, and
          // only where the student has not already answered.
          const { error: linkError } = await supabaseAdmin
            .from('student_profiles')
            .update({
              college_id,
              roll_number: theirProfile.roll_number || roll_number || null,
              branch: theirProfile.branch || branch || null,
              batch: theirProfile.batch || batch || null,
            })
            .eq('id', theirProfile.id)

          if (linkError) {
            results.push({ email, status: 'error', message: `Could not link: ${linkError.message}` })
            continue
          }

          if (phone) {
            await supabaseAdmin
              .from('student_contact')
              .upsert({ student_id: theirProfile.id, email: email.toLowerCase(), phone },
                      { onConflict: 'student_id' })
          }

          // No recovery link: they already have a password and use it. A
          // notification is the honest way to tell them what changed.
          await supabaseAdmin.from('notifications').insert({
            user_id: theirProfile.id,
            audience: 'student',
            source: 'system',
            type: 'college_linked',
            title: 'Your college has added you',
            message: 'Everything you have already done stays with you. You can now be placed ' +
                     'in a squad and appear on your college leaderboard.',
            link: '/student/dashboard',
          })

          results.push({
            email,
            status: 'linked',
            message: 'Signed up already — linked to your college, work kept',
            userId: existingAuthUser.id
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
              {
                student_id: newProfile.id,
                email: email.toLowerCase(),
                ...(phone ? { phone } : {}),
              },
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
            headers: { 'x-webhook-secret': Deno.env.get('WEBHOOK_SECRET') ?? '' },
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
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})