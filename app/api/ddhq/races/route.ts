import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AccountError } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { deleteDdhqSession, loadDdhqSession } from "@/lib/ddhq/vault";
import { ddhqSeats } from "@/lib/ddhq/votes";
import { appEnv, db } from "@/lib/env";

const PRIVATE = { "cache-control": "private, no-store" };
const bodySchema = z.object({
  seats: z.array(z.object({
    state: z.string().regex(/^[A-Z]{2}$/),
    office: z.enum(["senate", "house", "governor"]),
    district: z.number().int().nonnegative().nullable(),
    special: z.boolean(),
  })).max(512),
});

/** One private board pass; the upstream transport still uses bounded 24-race groups. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: PRIVATE });
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) return NextResponse.json({ error: "Votes connections aren't set up on this server." }, { status: 503, headers: PRIVATE });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Those races can't be looked up." }, { status: 400, headers: PRIVATE });
  const saved = await loadDdhqSession(db(), key, user.id);
  if (!saved) return NextResponse.json({ error: "Connect a Votes Pro account to see Decision Desk HQ here." }, { status: 404, headers: PRIVATE });
  try {
    const races = await ddhqSeats(saved.session, parsed.data.seats, req.signal);
    return NextResponse.json({ races }, { headers: PRIVATE });
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) await deleteDdhqSession(db(), user.id);
    const message = err instanceof AccountError ? err.message : "Decision Desk HQ didn't answer.";
    const status = err instanceof AccountError ? err.status : 502;
    return NextResponse.json({ error: message }, { status, headers: PRIVATE });
  }
}
