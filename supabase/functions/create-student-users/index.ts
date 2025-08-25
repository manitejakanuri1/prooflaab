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

    // Get request body
    const { students } = await req.json()
    
    if (!students || !Array.isArray(students)) {
      return new Response(
        JSON.stringify({ error: 'Students array is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const results = []

    for (const studentData of students) {
      const { name, email, branch, batch } = studentData

      try {
        // Check if user already exists
        const { data: existingProfile } = await supabaseAdmin
          .from('student_profiles')
          .select('email')
          .eq('email', email.toLowerCase())
          .maybeSingle()

        if (existingProfile) {
          results.push({
            email,
            status: 'duplicate',
            message: 'Email already exists in database'
          })
          continue
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

        // Create student profile
        const { error: profileError } = await supabaseAdmin
          .from('student_profiles')
          .insert({
            user_id: authData.user.id,
            email: email.toLowerCase(),
            full_name: name,
            branch: branch || '',
            batch: batch || '',
            total_xp: 0,
            trust_score: 0,
            status: 'active'
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

        results.push({
          email,
          status: 'success',
          message: 'Student account created successfully',
          userId: authData.user.id,
          tempPassword // Include temp password in response (for testing only)
        })

      } catch (error) {
        console.error('Student processing error:', error)
        results.push({
          email,
          status: 'error',
          message: `Unexpected error: ${error.message}`
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
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})