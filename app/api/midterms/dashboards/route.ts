import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/env";
import { listDashboards } from "@/lib/midterms/dashboard";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to keep dashboards." }, { status: 401 });
  return NextResponse.json({ dashboards: await listDashboards(db(), user.id) });
}
