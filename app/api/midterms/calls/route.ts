import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/env";
import { listCallEvents } from "@/lib/midterms/calls";

const query = z.object({
  office: z.enum(["senate", "house", "governor", "measure"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Older race-call events for the calls feed, newest first: `?office=senate&before=<event id>&limit=50`. */
export async function GET(req: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Use office (senate, house, governor or measure), before (an event id) and limit (1 to 100)." }, { status: 400 });
  try {
    return NextResponse.json({ events: await listCallEvents(db(), parsed.data) }, { headers: { "cache-control": "public, max-age=15" } });
  } catch (err) {
    console.error("midterm call events failed:", err);
    return NextResponse.json({ error: "Couldn't load race calls. Try again." }, { status: 503 });
  }
}
