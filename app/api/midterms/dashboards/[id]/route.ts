import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { deleteDashboard, listDashboards, renameDashboard } from "@/lib/midterms/dashboard";

const SIGN_IN = "Sign in to keep dashboards.";
const renameSchema = z.object({ title: z.string().trim().min(1, "Give the dashboard a name.").max(80) });

/** Renames a dashboard. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/midterms/dashboards/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  const body = renameSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const d = db();
  if (!(await renameDashboard(d, user.id, (await ctx.params).id, body.data.title, Date.now()))) return NextResponse.json({ error: "That dashboard doesn't exist." }, { status: 404 });
  return NextResponse.json({ dashboards: await listDashboards(d, user.id) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/midterms/dashboards/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  const d = db();
  await deleteDashboard(d, user.id, (await ctx.params).id);
  return NextResponse.json({ dashboards: await listDashboards(d, user.id) });
}
