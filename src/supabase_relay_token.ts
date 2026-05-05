type RuntimeSecretBindings = Record<string, string | undefined>;

interface TokenState {
  accessToken: string | null;
  expiresAtMs: number;
}

const tokenState: TokenState = {
  accessToken: null,
  expiresAtMs: 0,
};

export async function getSupabaseRelayAccessToken(
  env: RuntimeSecretBindings,
): Promise<string | null> {
  const now = Date.now();
  if (tokenState.accessToken && now < tokenState.expiresAtMs - 30_000) {
    return tokenState.accessToken;
  }

  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  const relayEmail = String(env.RELAY_SERVICE_ACCOUNT_EMAIL || "").trim();
  const relayPassword = String(env.RELAY_SERVICE_ACCOUNT_PASSWORD || "").trim();

  if (!supabaseUrl || !supabaseAnonKey || !relayEmail || !relayPassword) {
    return null;
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        email: relayEmail,
        password: relayPassword,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Supabase relay token request failed (${response.status}): ${body || "no body"}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("Supabase relay token response missing access_token");
  }

  const expiresInSec = Number(payload.expires_in || 3600);
  tokenState.accessToken = payload.access_token;
  tokenState.expiresAtMs = now + expiresInSec * 1000;
  return tokenState.accessToken;
}
