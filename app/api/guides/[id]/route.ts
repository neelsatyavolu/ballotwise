import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db, enqueueAlignment } from "@/lib/env";
import { scheduleAlignment } from "@/lib/values";
import { z } from "zod";
import { deleteGuide, getGuide, guideDataSchema, guideIdSchema, saveGuide, setVoted } from "@/lib/guides";

async function owner(params: Promise<{ id: string }>) {
  const user = await currentUser();
  const id = guideIdSchema.safeParse((await params).id);
  return { user, id: id.success ? id.data : null };
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/guides/[id]">) {
  const { user, id } = await owner(ctx.params);
  if (!user) return NextResponse.json({ error: "Sign in to open this guide." }, { status: 401 });
  const guide = id ? await getGuide(db(), user.id, id) : null;
  if (!guide) return NextResponse.json({ error: "That guide doesn't exist or isn't yours." }, { status: 404 });
  if (id && guide.status === "ready" && guide.data && !guide.suggested && !guide.error) {
    await scheduleAlignment(db(), user.id, [id], enqueueAlignment);
  }
  return NextResponse.json(guide);
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/guides/[id]">) {
  const { user, id } = await owner(ctx.params);
  if (!user) return NextResponse.json({ error: "Sign in to save guides." }, { status: 401 });
  if (!id) return NextResponse.json({ error: "Invalid guide id." }, { status: 400 });
  const data = guideDataSchema.safeParse(await req.json().catch(() => null));
  if (!data.success) return NextResponse.json({ error: "This guide couldn't be saved because its data is incomplete." }, { status: 400 });
  if (!(await saveGuide(db(), user.id, id, data.data, Date.now()))) {
    return NextResponse.json({ error: "This guide couldn't be saved." }, { status: 400 });
  }
  const complete = data.data.race.candidates.every((c) => data.data.profiles[c.id]);
  if (complete) await scheduleAlignment(db(), user.id, [id], enqueueAlignment);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/guides/[id]">) {
  const { user, id } = await owner(ctx.params);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = z.object({ voted: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!id || !body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  await setVoted(db(), user.id, id, body.data.voted);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/guides/[id]">) {
  const { user, id } = await owner(ctx.params);
  if (!user) return NextResponse.json({ error: "Sign in to delete guides." }, { status: 401 });
  if (id) await deleteGuide(db(), user.id, id);
  return NextResponse.json({ ok: true });
}
