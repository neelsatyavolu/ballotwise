import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signIn } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";

// Sign-in doesn't enforce the sign-up length rule, so the error never hints at what a password looks like.
const bodySchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254), password: z.string().min(1, "Enter your password.").max(200) });

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  try {
    const { user, token } = await signIn(db(), body.data.email, body.data.password, Date.now());
    await setAccountCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return accountFailure(err);
  }
}
