import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { listGuides } from "@/lib/guides";

/** The guides a person started by searching. Ballot guides come from /api/ballot. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your guides." }, { status: 401 });
  return NextResponse.json({ guides: await listGuides(db(), user.id, "search") });
}
