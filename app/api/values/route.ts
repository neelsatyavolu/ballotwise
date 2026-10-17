import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { db, enqueue } from "@/lib/env";
import { ResearchError } from "@/lib/grok/research";
import { activeGrokSession } from "@/lib/grok/session";
import { researchedGuideIds } from "@/lib/guides";
import { claimAlignment, getValues, MAX_QUESTIONS, nextTurn, questionsAsked, resetValues, saveValues, type TranscriptEntry, type ValuesState } from "@/lib/values";

export const maxDuration = 120;

function view(state: ValuesState) {
  return { ...state, asked: questionsAsked(state.transcript), maxQuestions: MAX_QUESTIONS };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to take the interview." }, { status: 401 });
  return NextResponse.json(view(await getValues(db(), user.id)));
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("answer"), text: z.string().trim().min(1, "Type an answer, or pick one.").max(1000) }),
  z.object({ action: z.literal("finish") }),
  z.object({ action: z.literal("restart") }),
]);

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to take the interview." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  let tokens;
  try {
    tokens = await activeGrokSession(user.id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grok session error." }, { status: 401 });
  }
  if (!tokens) return NextResponse.json({ error: "Connect Grok to take the interview." }, { status: 401 });

  const d = db();
  if (body.data.action === "restart") await resetValues(d, user.id);
  const state = await getValues(d, user.id);
  if (state.summary && body.data.action !== "restart") return NextResponse.json(view(state));

  let transcript: TranscriptEntry[] = state.transcript;
  if (body.data.action === "answer") transcript = [...transcript, { role: "voter", text: body.data.text }];
  else if (transcript.length > 0 && body.data.action !== "finish") return NextResponse.json(view(state));

  try {
    const next = await nextTurn(tokens, transcript, body.data.action === "finish");
    if ("role" in next) {
      await saveValues(d, user.id, [...transcript, next], null, Date.now());
    } else {
      await saveValues(d, user.id, transcript, next, Date.now());
      // Place the new interview on every race already researched; races still researching get it when they finish.
      const claimed = await claimAlignment(d, await researchedGuideIds(d, user.id));
      await enqueue(claimed.map((guideId) => ({ type: "align" as const, guideId })));
    }
    return NextResponse.json(view(await getValues(d, user.id)));
  } catch (err) {
    const status = err instanceof ResearchError ? err.status : 500;
    return NextResponse.json({ error: err instanceof ResearchError ? err.message : "The interview hit a problem. Try again." }, { status });
  }
}
