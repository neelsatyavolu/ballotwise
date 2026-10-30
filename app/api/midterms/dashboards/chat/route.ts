import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { ResearchError } from "@/lib/grok/research";
import { activeGrokSession } from "@/lib/grok/session";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { overview, UNAVAILABLE } from "@/lib/midterms/catalog";
import { chatTurn } from "@/lib/midterms/chat";
import { chatMessageSchema, listDashboards, type Dashboard } from "@/lib/midterms/dashboard";
import { listFavorites } from "@/lib/midterms/favorites";
import { ndjsonResponse } from "@/lib/stream";

export const maxDuration = 300;

const bodySchema = z.object({
  openId: z.string().max(64).nullable(),
  // The client keeps the conversation; only the recent turns are sent.
  messages: z.array(chatMessageSchema).min(1).max(16),
});

export type ChatResult = { reply: string; changed: boolean; focusId: string | null; dashboards: Dashboard[] };

/**
 * One chat turn, streamed as progress lines then the result: the assistant looks up what it needs across the
 * tracker's data (and the web), may create, edit or delete the voter's dashboards, and answers.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to chat about the races." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success || body.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "Type a message first." }, { status: 400 });

  let tokens;
  try {
    tokens = await activeGrokSession(user.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 401 });
  }
  if (!tokens) return NextResponse.json({ error: "Connect Grok to chat about the races." }, { status: 401 });

  const background = (work: Promise<unknown>) => getCloudflareContext().ctx.waitUntil(work);
  return ndjsonResponse<ChatResult>(async (progress) => {
    const d = db();
    const now = Date.now();
    let races;
    try {
      races = (await overview(d, now, background)).races;
    } catch {
      throw new ResearchError(UNAVAILABLE, 503);
    }
    const [dashboards, starred] = await Promise.all([listDashboards(d, user.id), listFavorites(d, user.id)]);
    const openId = dashboards.some((x) => x.id === body.data.openId) ? body.data.openId : null;
    const turn = await chatTurn(tokens, { db: d, userId: user.id, now, races, dashboards, openId, background, starred }, body.data.messages, progress);
    return { ...turn, dashboards: turn.changed ? await listDashboards(d, user.id) : dashboards };
  });
}
