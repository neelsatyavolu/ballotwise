"use client";

import type { Progress } from "./grok/research";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** JSON request that throws an ApiError carrying the server's readable message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status}).`, res.status);
  return json as T;
}

/** Calls a research route and reports each progress line until the result arrives. */
export async function streamResearch<T>(path: string, body: unknown, onProgress: (p: Progress) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(json.error ?? `Request failed (${res.status}).`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Progress | { type: "result"; data: T } | { type: "error"; error: string; status: number };
      if (msg.type === "result") return msg.data;
      if (msg.type === "error") throw new ApiError(msg.error, msg.status);
      onProgress(msg);
    }
    if (done) throw new ApiError("The connection closed before research finished. Try again.", 0);
  }
}

export function newGuideId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
