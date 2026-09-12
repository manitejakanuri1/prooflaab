import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";
import { mayActOnStudentWork } from "../_shared/authz.ts";

/**
 * Hand out a short-lived link to a proof file.
 *
 * The proofs bucket is private, so a signed URL is the only way in. Signing
 * happens here rather than in the browser because the rules for who may see a
 * proof cannot be written as a storage policy: a startup may see proofs on the
 * tasks it created, a college admin may see any, and a verified public proof may
 * be seen by someone who is not logged in at all. Those rules live on
 * proof_uploads, so this reads them from there and mirrors nothing.
 *
 * verify_jwt is off because the public portfolio and recruiter pages are open to
 * anonymous visitors. Anonymous callers get through only for proofs that are
 * both Verified and explicitly public — the same condition as the public SELECT
 * policy on the table.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

/** Long enough to open or download a video, short enough that a leaked link dies. */
const SIGNED_URL_SECONDS = 60 * 30;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const { proof_id, download } = await req.json();
    if (typeof proof_id !== 'string') {
      return json({ error: 'proof_id is required' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: proof } = await supabase
      .from('proof_uploads')
      .select('id, student_id, task_id, file_path, file_name, status, is_public, student_profiles(user_id, college_id)')
      .eq('id', proof_id)
      .maybeSingle();

    if (!proof) return json({ error: 'Proof not found' }, 404);
    if (!proof.file_path) {
      // A link-only submission, or one of the old records whose "file" was never
      // anything but a filename. Say so plainly instead of signing nothing.
      return json({ error: 'This submission has no uploaded file.', no_file: true }, 404);
    }

    // Caller identity. Absent is allowed; it just narrows what they can reach.
    let callerId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims } = await authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
      callerId = (claims?.claims?.sub as string | undefined) ?? null;
    }

    const isPubliclyVisible = proof.status === 'Verified' && proof.is_public === true;

    let allowed = isPubliclyVisible;

    if (!allowed && callerId) {
      // Owner, platform admin, or the college admin this student actually
      // belongs to. Previously any college_admin passed here regardless of
      // college, which reached every private proof on the platform.
      const ownerProfile = (proof as any).student_profiles;
      allowed = await mayActOnStudentWork(supabase, callerId, {
        ownerUserId: ownerProfile?.user_id ?? null,
        collegeId: ownerProfile?.college_id ?? null,
      });

      if (!allowed) {
        // A startup sees proofs answering a task it created, and nothing else.
        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', callerId);

        if ((roles ?? []).some((r: { role: string }) => r.role === 'startup')) {
          const { data: task } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', proof.task_id)
            .eq('created_by_startup_id', callerId)
            .maybeSingle();
          allowed = !!task;
        }
      }
    }

    if (!allowed) return json({ error: 'Not allowed to view this file' }, 403);

    const { data: signed, error: signError } = await supabase.storage
      .from('proofs')
      .createSignedUrl(
        proof.file_path,
        SIGNED_URL_SECONDS,
        download ? { download: proof.file_name ?? true } : undefined,
      );

    if (signError || !signed?.signedUrl) {
      console.error('Signing proof file failed:', signError);
      return json({ error: 'Could not open this file' }, 500);
    }

    return json({
      url: signed.signedUrl,
      file_name: proof.file_name,
      expires_in: SIGNED_URL_SECONDS,
    });
  } catch (error) {
    console.error('Error in proof-file-url:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
