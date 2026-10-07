export type ManagedInviteDelivery =
  | "onboarding_email"
  | "provider_reset_email"
  | "not_sent";

export interface ManagedInviteOutcome {
  invited: boolean;
  delivery: ManagedInviteDelivery;
  welcomeSent: boolean;
}

type GenerateResult = {
  data?: {
    properties?: {
      action_link?: string | null;
    } | null;
  } | null;
  error?: unknown;
};

type WelcomeResult = {
  data?: {
    success?: boolean;
  } | null;
  error?: unknown;
};

/**
 * Truthful managed-account invitation result.
 *
 * Google backend contract:
 * - action_link present: ProofLab must deliver that link in its welcome email.
 * - action_link null with no generateLink error: Identity Platform already
 *   accepted a PASSWORD_RESET email via accounts:sendOobCode.
 *
 * A 2xx onboarding response is NOT enough. send-onboarding-email deliberately
 * returns {success:false} with 200 when email delivery is not configured, so
 * callers must inspect the response body too.
 */
export async function deliverManagedInvite(
  generateLink: () => Promise<GenerateResult>,
  sendWelcome: (
    actionLink: string | null,
  ) => Promise<WelcomeResult>,
  nullLinkMeansProviderReset: boolean,
): Promise<ManagedInviteOutcome> {
  let generated: GenerateResult;

  try {
    generated = await generateLink();
  } catch {
    return {
      invited: false,
      delivery: "not_sent",
      welcomeSent: false,
    };
  }

  if (generated?.error) {
    return {
      invited: false,
      delivery: "not_sent",
      welcomeSent: false,
    };
  }

  const rawAction =
    generated?.data?.properties?.action_link;

  if (
    typeof rawAction === "string" &&
    rawAction.length > 0 &&
    !rawAction.startsWith("https://")
  ) {
    return {
      invited: false,
      delivery: "not_sent",
      welcomeSent: false,
    };
  }

  const actionLink =
    typeof rawAction === "string" &&
      rawAction.startsWith("https://")
      ? rawAction
      : null;

  let welcome: WelcomeResult = {
    data: null,
    error: new Error("welcome email not attempted"),
  };

  try {
    welcome = await sendWelcome(actionLink);
  } catch {
    // If Identity Platform itself already accepted the reset email,
    // a branded welcome-email failure must not turn that real delivery
    // into a false failure.
  }

  const welcomeSent =
    !welcome?.error &&
    welcome?.data?.success === true;

  if (actionLink) {
    return {
      invited: welcomeSent,
      delivery: welcomeSent
        ? "onboarding_email"
        : "not_sent",
      welcomeSent,
    };
  }

  if (nullLinkMeansProviderReset) {
    return {
      invited: true,
      delivery: "provider_reset_email",
      welcomeSent,
    };
  }

  return {
    invited: false,
    delivery: "not_sent",
    welcomeSent,
  };
}
