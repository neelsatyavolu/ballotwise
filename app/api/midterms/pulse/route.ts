import { NextResponse } from "next/server";
import { loadPulse } from "@/lib/ddhq/pulse";
import { db } from "@/lib/env";

/**
 * DDHQ Pulse, Decision Desk HQ's live chance of control for each chamber and of winning in the races it models, read
 * from its public balance-of-power pages at most once a minute for everyone (lib/ddhq/pulse.ts).
 */
export async function GET() {
  try {
    return NextResponse.json(await loadPulse(db(), Date.now()), { headers: { "cache-control": "public, max-age=30" } });
  } catch (err) {
    console.error("midterm pulse failed:", err);
    return NextResponse.json({ error: "Couldn't load DDHQ Pulse." }, { status: 503 });
  }
}
