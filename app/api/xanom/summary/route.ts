import { NextRequest, NextResponse } from "next/server";
import { appEnv, db } from "@/lib/env";
import { xanomConfig } from "@/lib/xanom/config";
import { issuerKeys, verifySummaryToken } from "@/lib/xanom/flow";
import { xanomSummary } from "@/lib/xanom/summary";

/** The Ballotwise card on the Xanom dashboard (xanom-accounts SPEC §4). Only accounts.xanom.co can ask. */
export async function GET(req: NextRequest) {
  const config = xanomConfig();
  if (!config) return NextResponse.json({ error: "Xanom isn't set up here." }, { status: 503 });
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Missing bearer token." }, { status: 401, headers: { "www-authenticate": "Bearer" } });
  let sub: string;
  try {
    sub = await verifySummaryToken(config, token, issuerKeys(config.issuer));
  } catch {
    return NextResponse.json({ error: "Invalid token." }, { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } });
  }
  const summary = await xanomSummary(db(), sub, appEnv().APP_URL);
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}
