import { NextRequest, NextResponse } from "next/server";
import { signUp } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { credentialsSchema, setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";

export async function POST(req: NextRequest) {
  const body = credentialsSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  try {
    const { user, token } = await signUp(db(), body.data.email, body.data.password, Date.now());
    await setAccountCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return accountFailure(err);
  }
}
