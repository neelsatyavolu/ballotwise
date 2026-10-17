import { NextResponse } from "next/server";
import { acceptedTerms } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { activeGrokSession } from "@/lib/grok/session";
import { TERMS_VERSION } from "@/lib/legal";
import { getValues } from "@/lib/values";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, grok: "disconnected", values: "none", terms: "accepted" });
  const v = await getValues(db(), user.id);
  const values = v.summary ? "done" : v.transcript.length > 0 ? "in-progress" : "none";
  const terms = (await acceptedTerms(db(), user.id)) === TERMS_VERSION ? "accepted" : "needed";
  try {
    return NextResponse.json({ user, values, terms, grok: (await activeGrokSession(user.id)) ? "connected" : "disconnected" });
  } catch {
    return NextResponse.json({ user, values, terms, grok: "refresh-failed" });
  }
}
