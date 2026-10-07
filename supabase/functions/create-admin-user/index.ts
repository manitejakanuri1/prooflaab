import { serve } from "../_shared/serve.ts";
import { createClient, findAccountByEmail } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = cors(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  const reply = (
    body: unknown,
    status = 200,
  ) =>
    new Response(
      JSON.stringify(body),
      {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const authHeader = req.headers.get("Authorization");

    if (
      !authHeader?.startsWith("Bearer ")
    ) {
      return reply(
        { error: "Unauthorized" },
        401,
      );
    }

    const token = authHeader.slice("Bearer ".length);

    const {
      data: userData,
      error: userError,
    } = await admin.auth.getUser(token);

    if (
      userError ||
      !userData?.user
    ) {
      return reply(
        { error: "Unauthorized" },
        401,
      );
    }

    const callerId = userData.user.id;

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    const isAdmin = (roles ?? []).some(
      (row: { role: string }) => row.role === "admin",
    );

    if (!isAdmin) {
      return reply(
        { error: "Forbidden" },
        403,
      );
    }

    const input = await req.json().catch(
      () => ({}),
    ) as {
      name?: unknown;
      email?: unknown;
    };

    const name = typeof input.name === "string" ? input.name.trim() : "";

    const email = typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";

    if (
      !name ||
      name.length > 120 ||
      !email ||
      !email.includes("@") ||
      email.length > 255
    ) {
      return reply(
        {
          error: "Valid admin name and email are required",
        },
        400,
      );
    }

    const existing = await findAccountByEmail(
      admin,
      email,
    );

    if (existing) {
      return reply(
        {
          error: "An account with this email already exists",
        },
        409,
      );
    }

    const tempPassword = `managed_${crypto.randomUUID()}_Aa1!`;

    const {
      data: authData,
      error: authError,
    } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: name,
      },
    });

    if (
      authError ||
      !authData.user
    ) {
      return reply(
        {
          error: authError?.message ??
            "Could not create admin login",
        },
        500,
      );
    }

    const { error: roleError } = await admin.rpc(
      "provision_admin_account",
      {
        _user_id: authData.user.id,
        _created_by: callerId,
      },
    );

    if (roleError) {
      console.error(
        "admin provisioning failed:",
        roleError,
      );

      const { error: rollbackError } =
        await admin.auth.admin.deleteUser(
          authData.user.id,
        );

      if (rollbackError) {
        console.error(
          "admin login rollback failed:",
          rollbackError,
        );
      }

      return reply(
        {
          error: rollbackError
            ? "Admin provisioning failed and automatic login rollback also failed. Administrator review is required."
            : "Admin provisioning failed. The login was rolled back; please try again.",
        },
        500,
      );
    }

    let invited = false;

    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
      });

      const { error: inviteError } = await admin.functions.invoke(
        "send-onboarding-email",
        {
          headers: {
            "x-webhook-secret": Deno.env.get(
              "WEBHOOK_SECRET",
            ) ?? "",
          },
          body: {
            email,
            name,
            userType: "admin",
            actionLink: link?.properties
              ?.action_link ?? null,
          },
        },
      );

      invited = inviteError === null;
    } catch (error) {
      console.error(
        "admin invite failed:",
        error,
      );
    }

    return reply({
      status: "success",
      userId: authData.user.id,
      invited,
    });
  } catch (error) {
    console.error(
      "create-admin-user error:",
      error,
    );

    return reply(
      {
        error: "Internal server error",
      },
      500,
    );
  }
});
