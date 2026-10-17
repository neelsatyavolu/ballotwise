import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { activeGrokSession } from "@/lib/grok/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, grok: "disconnected" });
  try {
    return NextResponse.json({ user, grok: (await activeGrokSession(user.id)) ? "connected" : "disconnected" });
  } catch {
    return NextResponse.json({ user, grok: "refresh-failed" });
  }
}
