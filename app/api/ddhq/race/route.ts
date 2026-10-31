import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AccountError } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/auth/session";
import { deleteDdhqSession, loadDdhqSession } from "@/lib/ddhq/vault";
import { ddhqRace } from "@/lib/ddhq/votes";
import { appEnv, db } from "@/lib/env";

const PRIVATE = { "cache-control": "private, no-store" };
const querySchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  office: z.enum(["senate", "house", "governor"]),
  district: z.coerce.number().int().nonnegative().optional(),
  special: z.enum(["1"]).optional(),
});

/** Decision Desk HQ's forecast and call for one race, using only this user's Votes Pro session. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: PRIVATE });
  const key = appEnv().GROK_TOKEN_KEY;
  if (!key) return NextResponse.json({ error: "Votes connections aren't set up on this server." }, { status: 503, headers: PRIVATE });
  const parsed = querySchema.safeParse({
    state: req.nextUrl.searchParams.get("state"),
    office: req.nextUrl.searchParams.get("office"),
    district: req.nextUrl.searchParams.get("district") ?? undefined,
    special: req.nextUrl.searchParams.get("special") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "That race can't be looked up." }, { status: 400, headers: PRIVATE });

  const saved = await loadDdhqSession(db(), key, user.id);
  if (!saved) return NextResponse.json({ error: "Connect a Votes Pro account to see Decision Desk HQ here." }, { status: 404, headers: PRIVATE });

  try {
    const race = await ddhqRace(saved.session, parsed.data.office, parsed.data.state, parsed.data.district ?? null, parsed.data.special === "1", req.signal);
    if (!race) return NextResponse.json({ error: "Decision Desk HQ doesn't list that race." }, { status: 404, headers: PRIVATE });
    return NextResponse.json(race, { headers: PRIVATE });
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) await deleteDdhqSession(db(), user.id);
    const message = err instanceof AccountError ? err.message : "Decision Desk HQ didn't answer.";
    const status = err instanceof AccountError ? err.status : 502;
    return NextResponse.json({ error: message }, { status, headers: PRIVATE });
  }
}
