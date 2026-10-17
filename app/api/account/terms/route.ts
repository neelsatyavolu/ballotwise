import { NextResponse } from "next/server";
import { acceptTerms } from "@/lib/auth/accounts";
import { accountFailure } from "@/lib/auth/respond";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { TERMS_VERSION } from "@/lib/legal";

/** Records that the signed-in user accepted the current Terms and Privacy Policy. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    await acceptTerms(db(), user.id, TERMS_VERSION, Date.now());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountFailure(err);
  }
}
