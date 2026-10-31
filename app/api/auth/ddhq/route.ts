import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AccountError, hashToken } from "@/lib/auth/accounts";
import { accountFailure, invalid } from "@/lib/auth/respond";
import { currentUser } from "@/lib/auth/session";
import { endVotesSession, finishVotesCode, startVotesCode, votesSessionCookie } from "@/lib/ddhq/clerk";
import { deleteDdhqPending, loadDdhqPending, storeDdhqPending } from "@/lib/ddhq/pending";
import { deleteDdhqSession, loadDdhqSession, storeDdhqSession } from "@/lib/ddhq/vault";
import { votesIsPro } from "@/lib/ddhq/votes";
import { appEnv, db } from "@/lib/env";

const WINDOW = 15 * 60 * 1000;

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email on your Votes account.").max(254),
});
const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, "Enter the code from your email."),
});

async function pace(userId: string, kind: string, max: number) {
  const now = Date.now();
  const key = hashToken(`ddhq:${kind}:${userId}`);
  const row = await db().prepare("SELECT COUNT(*) AS n FROM attempts WHERE key_hash = ? AND created_at > ?").bind(key, now - WINDOW).first<{ n: number }>();
  if ((row?.n ?? 0) >= max) throw new AccountError("Too many tries. Wait a few minutes.", 429);
  await db().prepare("INSERT INTO attempts (key_hash, created_at) VALUES (?, ?)").bind(key, now).run();
}

async function disconnect(userId: string) {
  const key = appEnv().GROK_TOKEN_KEY;
  if (key) {
    const saved = await loadDdhqSession(db(), key, userId);
    if (saved) await endVotesSession(saved.session);
  }
  await deleteDdhqSession(db(), userId);
  await deleteDdhqPending(db(), userId);
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to Ballotwise before connecting Votes." }, { status: 401 });
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) return NextResponse.json({ error: "Votes connections aren't set up on this server." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const code = codeSchema.safeParse(body);
  const email = emailSchema.safeParse(body);
  if (!code.success && !email.success) return invalid((body && typeof body === "object" && "code" in body ? code : email).error);

  try {
    if (code.success) {
      await pace(user.id, "code", 8);
      const pending = await loadDdhqPending(db(), key, user.id, Date.now());
      if (!pending) return NextResponse.json({ error: "That code expired. Send a new one." }, { status: 400 });
      const session = await finishVotesCode(pending.pending, code.data.code);
      const cookie = await votesSessionCookie(session);
      if (!(await votesIsPro(cookie))) {
        return NextResponse.json({ error: "That Votes account isn't Pro. Decision Desk HQ stays off until it is." }, { status: 403 });
      }
      await storeDdhqSession(db(), key, user.id, pending.email, session, Date.now());
      await deleteDdhqPending(db(), user.id);
      return NextResponse.json({ ok: true });
    }
    if (!email.success) return invalid(email.error);
    await pace(user.id, "email", 5);
    const started = await startVotesCode(email.data.email);
    await storeDdhqPending(db(), key, user.id, email.data.email, started, Date.now());
    return NextResponse.json({ step: "code" });
  } catch (err) {
    if (err instanceof AccountError) return NextResponse.json({ error: err.message }, { status: err.status });
    return accountFailure(err);
  }
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await disconnect(user.id);
  return NextResponse.json({ ok: true });
}
