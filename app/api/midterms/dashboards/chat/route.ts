import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { ResearchError } from "@/lib/grok/research";
import { activeGrokSession } from "@/lib/grok/session";
import { overview, UNAVAILABLE } from "@/lib/midterms/catalog";
import { applyAction, chatMessageSchema, chatTurn, DashboardError, listDashboards } from "@/lib/midterms/dashboard";

export const maxDuration = 120;

const bodySchema = z.object({
  openId: z.string().max(64).nullable(),
  // The client keeps the conversation; only the recent turns are sent.
  messages: z.array(chatMessageSchema).min(1).max(16),
});

/** One chat turn: Grok answers and may create, edit or delete one of the voter's dashboards. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to build dashboards." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success || body.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "Type a message first." }, { status: 400 });

  let tokens;
  try {
    tokens = await activeGrokSession(user.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 401 });
  }
  if (!tokens) return NextResponse.json({ error: "Connect Grok to build dashboards." }, { status: 401 });

  let races;
  try {
    races = (await overview(Date.now())).races;
  } catch {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }
  const d = db();
  try {
    const dashboards = await listDashboards(d, user.id);
    const openId = dashboards.some((x) => x.id === body.data.openId) ? body.data.openId : null;
    const turn = await chatTurn(tokens, races, dashboards, openId, body.data.messages);
    const focusId = await applyAction(d, user.id, turn.action, races, openId, Date.now(), dashboards);
    return NextResponse.json({ reply: turn.reply, changed: turn.action.type !== "none", focusId, dashboards: await listDashboards(d, user.id) });
  } catch (err) {
    if (err instanceof DashboardError) return NextResponse.json({ error: err.message }, { status: 400 });
    const status = err instanceof ResearchError ? err.status : 500;
    return NextResponse.json({ error: err instanceof ResearchError ? err.message : "Grok couldn't answer. Try again." }, { status });
  }
}
