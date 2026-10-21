import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { AI_PROVIDERS, startGrokSignIn } from "@/lib/grok/oauth";
import { writePkceCookie } from "@/lib/grok/session";

const bodySchema = z.object({ provider: z.enum(AI_PROVIDERS).default("grok") });

export async function POST(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in before connecting an AI account." }, { status: 401 });
  const body = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!body.success) return NextResponse.json({ error: "Choose Grok or ChatGPT." }, { status: 400 });
  const { provider } = body.data;
  const { verifier, state, url } = startGrokSignIn(provider);
  await writePkceCookie({ verifier, state, provider });
  return NextResponse.json({ authorizeUrl: url });
}
