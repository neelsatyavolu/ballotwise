import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { activeGrokSession } from "@/lib/grok/session";
import { getValues } from "@/lib/values";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, grok: "disconnected", values: "none" });
  const v = await getValues(db(), user.id);
  const values = v.summary ? "done" : v.transcript.length > 0 ? "in-progress" : "none";
  try {
    return NextResponse.json({ user, values, grok: (await activeGrokSession(user.id)) ? "connected" : "disconnected" });
  } catch {
    return NextResponse.json({ user, values, grok: "refresh-failed" });
  }
}
