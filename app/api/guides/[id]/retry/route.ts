import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import type { Job } from "@/lib/ballot/jobs";
import { db, enqueue } from "@/lib/env";
import { getGuide, guideIdSchema, setGuideStatus } from "@/lib/guides";

/** Re-queues background research: the whole race if it failed, otherwise only the candidates that failed. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/guides/[id]/retry">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = guideIdSchema.safeParse((await ctx.params).id);
  const guide = id.success ? await getGuide(db(), user.id, id.data) : null;
  if (!id.success || !guide) return NextResponse.json({ error: "That guide doesn't exist or isn't yours." }, { status: 404 });
  if (guide.origin !== "ballot") return NextResponse.json({ error: "Only ballot guides research in the background." }, { status: 400 });

  const failed = Object.keys(guide.failedCandidates);
  const jobs: Job[] =
    !guide.data || (guide.status === "failed" && failed.length === 0)
      ? [{ type: "race", guideId: id.data }]
      : failed.map((candidateId) => ({ type: "candidate", guideId: id.data, candidateId }));
  if (jobs.length === 0) return NextResponse.json({ ok: true });
  await setGuideStatus(db(), id.data, jobs[0].type === "race" ? "queued" : "researching", null, Date.now());
  await enqueue(jobs);
  return NextResponse.json({ ok: true });
}
