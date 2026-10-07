type Env = {
  get(name: string): string | undefined;
};

let cached: { token: string; expiresAt: number } | null = null;

export async function bridgeServiceToken(
  env: Env = Deno.env,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const bridge = (env.get("AUTH_BRIDGE_URL") ?? "").replace(/\/+$/, "");

  if (!bridge) {
    throw new Error("AUTH_BRIDGE_URL is missing");
  }

  const now = Date.now();

  if (cached && cached.expiresAt > now + 30_000) {
    return cached.token;
  }

  const metadataUrl =
    "http://metadata.google.internal/computeMetadata/v1/" +
    "instance/service-accounts/default/identity" +
    `?audience=${encodeURIComponent(bridge)}`;

  const identity = await fetcher(metadataUrl, {
    headers: {
      "Metadata-Flavor": "Google",
    },
  });

  if (!identity.ok) {
    throw new Error(
      `could not obtain BFF service identity: ${identity.status}`,
    );
  }

  const googleIdentityToken = (await identity.text()).trim();

  if (!googleIdentityToken) {
    throw new Error("metadata server returned an empty identity token");
  }

  const response = await fetcher(`${bridge}/service-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${googleIdentityToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `auth bridge refused BFF service identity: ${response.status}`,
    );
  }

  const body = await response.json() as {
    access_token?: unknown;
    expires_in?: unknown;
  };

  if (
    typeof body.access_token !== "string" ||
    !body.access_token ||
    typeof body.expires_in !== "number" ||
    body.expires_in <= 0
  ) {
    throw new Error("auth bridge returned an invalid service token");
  }

  cached = {
    token: body.access_token,
    expiresAt: now + body.expires_in * 1000,
  };

  return cached.token;
}

export function resetBridgeServiceTokenCache(): void {
  cached = null;
}
