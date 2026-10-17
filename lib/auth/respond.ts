import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { AccountError } from "./accounts";

export function invalid(error: ZodError): NextResponse {
  return NextResponse.json({ error: error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
}

export function accountFailure(err: unknown): NextResponse {
  if (err instanceof AccountError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("account request failed:", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
}
