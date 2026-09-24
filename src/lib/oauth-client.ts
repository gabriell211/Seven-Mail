import { openUrl } from "@tauri-apps/plugin-opener";
import type { AccountProfile } from "../types";

const PENDING_PREFIX = "seven-mail:oauth:";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface PendingOAuth {
  accountId: string;
  verifier: string;
  redirectUri: string;
  createdAt: string;
}

export function oauthPreset(provider: AccountProfile["provider"]): Partial<AccountProfile> {
  if (provider === "gmail") {
    return {
      oauthEnabled: true,
      oauthAuthorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      oauthTokenUrl: "https://oauth2.googleapis.com/token",
      oauthScopes: ["https://mail.google.com/"],
      oauthRedirectUri: "seven-mail://oauth/callback",
    };
  }
  if (provider === "microsoft") {
    return {
      oauthEnabled: true,
      oauthAuthorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      oauthTokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      oauthScopes: [
        "offline_access",
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
      ],
      oauthRedirectUri: "seven-mail://oauth/callback",
    };
  }
  return {};
}

export async function startOAuthAuthorization(account: AccountProfile): Promise<void> {
  if (!account.oauthEnabled) throw new Error("OAuth não está ativado nesta conta.");
  if (!account.oauthClientId?.trim()) throw new Error("Informe o Client ID OAuth.");
  if (!account.oauthAuthorizationUrl?.trim()) throw new Error("Informe a URL de autorização OAuth.");

  const verifier = randomToken(48);
  const state = randomToken(24);
  const redirectUri = account.oauthRedirectUri?.trim() || "seven-mail://oauth/callback";
  const pending: PendingOAuth = {
    accountId: account.id,
    verifier,
    redirectUri,
    createdAt: new Date().toISOString(),
  };
  sessionStorage.setItem(PENDING_PREFIX + state, JSON.stringify(pending));

  const url = new URL(account.oauthAuthorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", account.oauthClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", (account.oauthScopes ?? []).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  if (account.provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }

  await openUrl(url.toString());
}

export function takePendingOAuth(state: string): PendingOAuth | null {
  const key = PENDING_PREFIX + state;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return null;

  try {
    const pending = JSON.parse(raw) as PendingOAuth;
    if (Date.now() - new Date(pending.createdAt).getTime() > 15 * 60_000) return null;
    return pending;
  } catch {
    return null;
  }
}
