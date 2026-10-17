import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "../env";
import { clearPkceCookie } from "../grok/session";
import { endSession, SESSION_TTL_MS, userForSession, type User } from "./accounts";

const COOKIE = "bw_session";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(10, "Use at least 10 characters.").max(200, "That password is too long."),
});

export async function setAccountCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? userForSession(db(), token, Date.now()) : null;
}

/** Signs out of the account in this browser. */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await endSession(db(), token);
  jar.delete(COOKIE);
  await clearPkceCookie();
}
