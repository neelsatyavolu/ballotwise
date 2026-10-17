import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { startGrokSignIn } from "@/lib/grok/oauth";
import { writePkceCookie } from "@/lib/grok/session";

export async function POST() {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in before connecting Grok." }, { status: 401 });
  const { verifier, state, url } = startGrokSignIn();
  await writePkceCookie({ verifier, state });
  return NextResponse.json({ authorizeUrl: url });
}
