import { cookies } from "next/headers";
import { appEnv, db } from "../env";
import { refreshGrokTokens, type GrokTokens } from "./oauth";
import { deleteGrokTokens, storeGrokTokens, usableGrokTokens } from "./vault";

const PKCE_COOKIE = "grok_pkce";
const PKCE_TTL_SECONDS = 10 * 60;

type PkceCookie = { verifier: string; state: string };

export async function writePkceCookie(value: PkceCookie): Promise<void> {
  (await cookies()).set(PKCE_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PKCE_TTL_SECONDS,
  });
}

export async function readPkceCookie(): Promise<PkceCookie | null> {
  const raw = (await cookies()).get(PKCE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.verifier === "string" && typeof parsed.state === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearPkceCookie(): Promise<void> {
  (await cookies()).delete(PKCE_COOKIE);
}

function tokenKey(): string {
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) throw new Error("GROK_TOKEN_KEY is not configured.");
  return key;
}

export async function saveGrokConnection(userId: string, tokens: GrokTokens): Promise<void> {
  await storeGrokTokens(db(), tokenKey(), userId, tokens, Date.now());
}

export async function removeGrokConnection(userId: string): Promise<void> {
  await deleteGrokTokens(db(), userId);
}

/** Usable Grok tokens for this account, or null when it hasn't connected Grok. */
export async function activeGrokSession(userId: string): Promise<GrokTokens | null> {
  try {
    return await usableGrokTokens(db(), tokenKey(), userId, refreshGrokTokens);
  } catch {
    throw new Error("Could not refresh your Grok connection. Try again, or reconnect Grok.");
  }
}
