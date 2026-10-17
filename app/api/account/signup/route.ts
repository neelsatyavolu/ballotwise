import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signUp } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { credentialsSchema, setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { TERMS_VERSION } from "@/lib/legal";

const signupSchema = credentialsSchema.extend({
  acceptTerms: z.literal(true, { error: "Accept the Terms of Service and Privacy Policy to create an account." }),
});

export async function POST(req: NextRequest) {
  const body = signupSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  try {
    const { user, token } = await signUp(db(), body.data.email, body.data.password, Date.now(), TERMS_VERSION);
    await setAccountCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return accountFailure(err);
  }
}
