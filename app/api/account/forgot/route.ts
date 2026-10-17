import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestReset } from "@/lib/auth/accounts";
import { MailError, resetEmail, sendEmail } from "@/lib/auth/mail";
import { invalid } from "@/lib/auth/respond";
import { appEnv, db } from "@/lib/env";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254) });
const SENT = { message: "If an account uses that email, a reset link is on its way. Check your inbox." };

export async function POST(req: NextRequest) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return invalid(body.error);
  const env = appEnv();
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set; password reset email cannot be sent.");
    return NextResponse.json({ error: "Password reset email isn't available right now." }, { status: 503 });
  }
  try {
    const reset = await requestReset(db(), body.data.email, Date.now());
    // The answer is the same whether or not the account exists, so this can't be used to find accounts.
    if (reset) {
      const link = `${env.APP_URL}/reset?token=${encodeURIComponent(reset.token)}`;
      await sendEmail(env.RESEND_API_KEY, reset.email, resetEmail(link));
    }
    return NextResponse.json(SENT);
  } catch (err) {
    console.error("password reset request failed:", err instanceof Error ? err.message : err);
    // 422 means Resend won't deliver to that address. Answering differently would reveal the account exists.
    if (err instanceof MailError && err.status === 422) return NextResponse.json(SENT);
    return NextResponse.json({ error: "We couldn't send the email. Try again in a minute." }, { status: 502 });
  }
}
