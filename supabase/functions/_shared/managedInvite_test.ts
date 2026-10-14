import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deliverManagedInvite,
} from "./managedInvite.ts";

Deno.test(
  "managed invite: ProofLab link + successful welcome is invited",
  async () => {
    const r = await deliverManagedInvite(
      async () => ({
        data: {
          properties: {
            action_link: "https://example.test/set-password",
          },
        },
        error: null,
      }),
      async () => ({
        data: { success: true },
        error: null,
      }),
      true,
    );

    assertEquals(r, {
      invited: true,
      delivery: "onboarding_email",
      welcomeSent: true,
    });
  },
);

Deno.test(
  "managed invite: HTTP success with success:false is NOT an invitation",
  async () => {
    const r = await deliverManagedInvite(
      async () => ({
        data: {
          properties: {
            action_link: "https://example.test/set-password",
          },
        },
        error: null,
      }),
      async () => ({
        data: { success: false },
        error: null,
      }),
      true,
    );

    assertEquals(r.invited, false);
    assertEquals(r.delivery, "not_sent");
  },
);

Deno.test(
  "managed invite: invoke error is NOT an invitation",
  async () => {
    const r = await deliverManagedInvite(
      async () => ({
        data: {
          properties: {
            action_link: "https://example.test/set-password",
          },
        },
        error: null,
      }),
      async () => ({
        data: null,
        error: new Error("mail failed"),
      }),
      true,
    );

    assertEquals(r.invited, false);
  },
);

Deno.test(
  "managed invite: Google null link means provider reset email was accepted",
  async () => {
    const r = await deliverManagedInvite(
      async () => ({
        data: {
          properties: {
            action_link: null,
          },
        },
        error: null,
      }),
      async () => {
        throw new Error("welcome unavailable");
      },
      true,
    );

    assertEquals(r, {
      invited: true,
      delivery: "provider_reset_email",
      welcomeSent: false,
    });
  },
);

Deno.test(
  "managed invite: generateLink failure is not hidden",
  async () => {
    let welcomeCalled = false;

    const r = await deliverManagedInvite(
      async () => ({
        data: null,
        error: new Error("reset unavailable"),
      }),
      async () => {
        welcomeCalled = true;
        return {
          data: { success: true },
          error: null,
        };
      },
      true,
    );

    assertEquals(r.invited, false);
    assertEquals(welcomeCalled, false);
  },
);
