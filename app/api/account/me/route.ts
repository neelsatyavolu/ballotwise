import { NextResponse } from "next/server";
import { acceptedTerms } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { hasDdhqSession } from "@/lib/ddhq/vault";
import { activeGrokSession } from "@/lib/grok/session";
import { TERMS_VERSION } from "@/lib/legal";
import { getValues } from "@/lib/values";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, grok: "disconnected", provider: null, values: "none", terms: "accepted", ddhq: "disconnected" });
  const v = await getValues(db(), user.id);
  const values = v.summary ? "done" : v.transcript.length > 0 ? "in-progress" : "none";
  const terms = (await acceptedTerms(db(), user.id)) === TERMS_VERSION ? "accepted" : "needed";
  const ddhq = (await hasDdhqSession(db(), user.id)) ? "connected" : "disconnected";
  try {
    const session = await activeGrokSession(user.id);
    return NextResponse.json({ user, values, terms, grok: session ? "connected" : "disconnected", provider: session?.provider ?? null, ddhq });
  } catch {
    return NextResponse.json({ user, values, terms, grok: "refresh-failed", provider: null, ddhq });
  }
}
