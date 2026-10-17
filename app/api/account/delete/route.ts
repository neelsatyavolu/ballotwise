import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteAccount } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { currentUser, signOut } from "@/lib/auth/session";
import { db } from "@/lib/env";

const deleteSchema = z.object({ password: z.string().min(1, "Enter your password.").max(200) });

/** Deletes the signed-in account and all of its data, after checking the password. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  try {
    await deleteAccount(db(), user.id, body.data.password);
    await signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountFailure(err);
  }
}
