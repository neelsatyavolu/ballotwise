import { NextResponse } from "next/server";
import { AccountError } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { ddhqForecast } from "@/lib/ddhq/forecast";
import { deleteDdhqSession, loadDdhqSession } from "@/lib/ddhq/vault";
import { appEnv, db } from "@/lib/env";

const headers = { "cache-control": "private, no-store" };

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) return NextResponse.json({ error: "Votes connections aren't set up on this server." }, { status: 503, headers });
  const saved = await loadDdhqSession(db(), key, user.id);
  if (!saved) return NextResponse.json({ error: "Connect a Votes Pro account to see Decision Desk HQ here." }, { status: 404, headers });
  try {
    return NextResponse.json(await ddhqForecast(saved.session), { headers });
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) await deleteDdhqSession(db(), user.id);
    return NextResponse.json({ error: err instanceof AccountError ? err.message : "Decision Desk HQ didn't answer." }, { status: err instanceof AccountError ? err.status : 502, headers });
  }
}
