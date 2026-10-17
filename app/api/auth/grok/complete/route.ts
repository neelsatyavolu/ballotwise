import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { exchangeGrokCode, readGrokCallback } from "@/lib/grok/oauth";
import { clearPkceCookie, readPkceCookie, saveGrokConnection } from "@/lib/grok/session";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in before connecting Grok." }, { status: 401 });
  const body = z.object({ callback: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  const callback = body.success ? body.data.callback : "";
  if (!callback) return NextResponse.json({ error: "Paste the code or link Grok showed you." }, { status: 400 });

  const { code, state, error } = readGrokCallback(callback);
  if (error) return NextResponse.json({ error: "Grok sign-in was cancelled or failed. Start again." }, { status: 400 });
  if (!code) return NextResponse.json({ error: "That doesn't contain a sign-in code. Copy the full code Grok showed." }, { status: 400 });

  const pkce = await readPkceCookie();
  if (!pkce) return NextResponse.json({ error: "The sign-in attempt expired. Select Connect Grok again." }, { status: 400 });
  // A bare code (no state) belongs to the one pending attempt stored in this browser.
  if (state && state !== pkce.state) {
    return NextResponse.json({ error: "That code is from a different sign-in attempt. Start again." }, { status: 400 });
  }

  try {
    await saveGrokConnection(user.id, await exchangeGrokCode(code, pkce.verifier));
    await clearPkceCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("grok token exchange failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Grok didn't accept that code. Codes expire quickly, so start again." }, { status: 502 });
  }
}
