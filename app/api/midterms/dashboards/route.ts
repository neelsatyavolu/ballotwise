import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { createGrid, DashboardError, listDashboards } from "@/lib/midterms/dashboard";
import { gridLayoutSchema } from "@/lib/midterms/decisionView";

const SIGN_IN = "Sign in to keep dashboards.";
const createSchema = z.object({ layout: gridLayoutSchema });

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  return NextResponse.json({ dashboards: await listDashboards(db(), user.id) });
}

/** Creates a Decision View dashboard from a layout (blank, a template, or a copy). */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 });
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid dashboard." }, { status: 400 });
  const d = db();
  try {
    const id = await createGrid(d, user.id, body.data.layout, Date.now());
    return NextResponse.json({ id, dashboards: await listDashboards(d, user.id) });
  } catch (err) {
    if (err instanceof DashboardError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
