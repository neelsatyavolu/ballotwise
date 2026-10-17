import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { clearPkceCookie, removeGrokConnection } from "@/lib/grok/session";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await clearPkceCookie();
  await removeGrokConnection(user.id);
  return NextResponse.json({ ok: true });
}
