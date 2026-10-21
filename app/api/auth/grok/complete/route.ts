import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { exchangeGrokCode, PROVIDER_LABEL, readGrokCallback } from "@/lib/grok/oauth";
import { clearPkceCookie, readPkceCookie, saveGrokConnection } from "@/lib/grok/session";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in before connecting an AI account." }, { status: 401 });
  const pkce = await readPkceCookie();
  const name = PROVIDER_LABEL[pkce?.provider ?? "grok"];
  const body = z.object({ callback: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  const callback = body.success ? body.data.callback : "";
  if (!callback) return NextResponse.json({ error: `Paste the code or link ${name} showed you.` }, { status: 400 });

  const { code, state, error } = readGrokCallback(callback);
  if (error) return NextResponse.json({ error: `${name} sign-in was cancelled or failed. Start again.` }, { status: 400 });
  if (!code) return NextResponse.json({ error: `That doesn't contain a sign-in code. Copy the full code or address ${name} showed.` }, { status: 400 });

  if (!pkce) return NextResponse.json({ error: "The sign-in attempt expired. Open the sign-in again." }, { status: 400 });
  // A bare code (no state) belongs to the one pending attempt stored in this browser.
  if (state && state !== pkce.state) {
    return NextResponse.json({ error: "That code is from a different sign-in attempt. Start again." }, { status: 400 });
  }

  try {
    // One AI connection per account: connecting ChatGPT replaces Grok, and the reverse.
    await saveGrokConnection(user.id, await exchangeGrokCode(code, pkce.verifier, pkce.provider));
    await clearPkceCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`${pkce.provider} token exchange failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: `${name} didn't accept that code. Codes expire quickly, so start again.` }, { status: 502 });
  }
}
