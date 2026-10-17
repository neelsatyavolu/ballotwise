import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finishReset } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { credentialsSchema, setAccountCookie } from "@/lib/auth/session";
import { db } from "@/lib/env";

const bodySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This reset link is incomplete. Open it again from the email."),
  password: credentialsSchema.shape.password,
});

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  try {
    const { user, token } = await finishReset(db(), body.data.token, body.data.password, Date.now());
    await setAccountCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return accountFailure(err);
  }
}
