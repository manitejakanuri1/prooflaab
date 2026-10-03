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

    // Section of each student, applied after the loop so squads can be formed
    // by section right here - every way of adding students, not just the page.
    const cohortByEmail = new Map<string, string>()

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
        // Section, as the CSV has it ("CSE-A"), or just the section letter.
        cohort = '',
        section = '',
        // §6 lists phone as a required CSV column. The importer normalises it
        // to ten digits before it gets here, or sends an empty string.
        phone = ''
      } = studentData

      {
        const c = String(cohort || '').trim() || (String(section || '').trim() && String(branch || '').trim()
          ? `${String(branch).trim()}-${String(section).trim()}` : '')
        if (c && email) cohortByEmail.set(String(email).trim().toLowerCase(), c)
      }

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

          // F4: only a confirmed address may be linked. Otherwise anyone could
          // sign up with a student's email before the college's CSV arrives and
          // be linked as that student. Checked on the server, never trusted from
          // the browser. The real owner verifies their email, then the import is
          // run again and links them.
          const { data: confirmed, error: confirmError } = await supabaseAdmin
            .rpc('account_email_confirmed', { _id: existingAuthUser.id })
          if (confirmError || confirmed !== true) {
            results.push({
              email,
              status: 'unverified',
              message: confirmError
                ? 'Could not check this login, so it was not linked. Try the import again.'
                : 'A login exists for this email but the address was never confirmed, so it was not linked. ' +
                  'Ask the student to open the verification email (or sign in with Google), then import again.'
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

        // Role + profile + contact in ONE database transaction (F19, migration 62).
        // These were three separate writes, and a failed role write was only logged,
        // so a failure in the middle left a login with a role and no profile, or a
        // profile with no role. Now either all three exist or none does; the login
        // that was just created is reused by the next import (the "existing account
        // with no profile" branch above), so running the import again finishes the job.
        const { error: recordError } = await supabaseAdmin.rpc('import_student_record', {
          _user_id: authData.user.id,
          _college_id: college_id,
          _email: email.toLowerCase(),
          _full_name: name,
          _branch: branch || '',
          _year_of_study: year_of_study || '',
          _preferred_skills: preferredSkillsArray,
          _key_interests: keyInterestsArray,
          _career_goals: career_goals || '',
          _roll_number: roll_number || null,
          _batch: batch || null,
          _phone: phone || null,
          _existing_profile_id: profileNeedsAuth && existingProfile ? existingProfile.id : null,
        })
        if (recordError) {
          console.error('IMPORT RECORD FAILED (nothing was written for this student):', recordError)
          results.push({
            email,
            status: 'error',
            message: `Could not save this student: ${recordError.message}. Nothing was saved for them; import the file again to retry.`
          })
          continue
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

    // Sections first, then squads, so they are drawn inside each section.
    // Squads used to form only when the college's upload page asked for them
    // afterwards (or at 05:35 the next morning), so a student added any other
    // way sat in reserve with eleven others (18 Sep). Never fails the import.
    let squads: unknown = null
    const added = results.filter((r: any) => r.status === 'success' || r.status === 'linked')
    if (added.length > 0) {
      try {
        for (const r of added) {
          const c = cohortByEmail.get(String(r.email).toLowerCase())
          const id = (r as any).userId
          if (c && id) {
            await supabaseAdmin.from('student_profiles').update({ cohort: c }).eq('user_id', id)
          }
        }
        const { data: sq, error: sqErr } = await supabaseAdmin.rpc('form_squads', { _college_id: college_id })
        squads = sqErr ? { error: sqErr.message } : sq
      } catch (e) {
        squads = { error: String(e) }
      }
    }

    return new Response(
      JSON.stringify({ results, squads }),
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