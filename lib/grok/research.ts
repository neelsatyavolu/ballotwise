import type { ZodType } from "zod";
import { extractJson } from "../json";
import { normalizeUrl } from "../url";
import { CODEX_RESPONSES_URL, GROK_API_BASE, grokModel, PROVIDER_LABEL, type GrokTokens } from "./oauth";

const TIMEOUT_MS = 280_000;

export type Progress = { type: "search"; query: string } | { type: "writing" };

export class ResearchError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

type StreamEvent = {
  type?: string;
  item?: { type?: string; action?: { query?: string; url?: string; sources?: { url?: string }[] } };
  annotation?: { url?: string };
  response?: { output?: { type?: string; content?: { text?: string }[] }[] };
};

type GrokReply = { text: string; retrieved: Set<string> };

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // A malformed keep-alive line carries no content.
      }
    }
  }
}

type InputMessage = { role: string; content: string };

/** The Responses request for the account's provider. ChatGPT's backend takes the system prompt as `instructions` and typed content parts. */
async function request(tokens: GrokTokens, body: Record<string, unknown>): Promise<[string, RequestInit]> {
  // Low effort keeps a full candidate profile near one minute instead of three, with the same search depth.
  const common = { model: await grokModel(tokens.provider), reasoning: { effort: "low" }, store: false, stream: true };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  if (tokens.provider === "grok") {
    return [`${GROK_API_BASE}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.accessToken}` },
      body: JSON.stringify({ ...common, ...body }),
      signal,
    }];
  }
  const input = (body.input as InputMessage[]) ?? [];
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${tokens.accessToken}`,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=v1",
  };
  if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;
  return [CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      ...body,
      instructions: input.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      input: input.filter((m) => m.role !== "system").map((m) => ({
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
      })),
    }),
    signal,
  }];
}

async function callGrok(tokens: GrokTokens, body: Record<string, unknown>, onProgress: (p: Progress) => void): Promise<GrokReply> {
  const name = PROVIDER_LABEL[tokens.provider];
  let res: Response;
  try {
    res = await fetch(...(await request(tokens, body)));
  } catch {
    throw new ResearchError(`Could not reach ${name}. Check your connection and try again.`);
  }

  if (res.status === 401 || res.status === 403) throw new ResearchError(`${name} rejected this session. Reconnect ${name}.`, 401);
  if (res.status === 429) throw new ResearchError(`Your ${name} account hit its usage limit. Wait a bit and try again.`, 429);
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(`${tokens.provider} responses failed (${res.status}): ${detail.slice(0, 300)}`);
    throw new ResearchError(`${name} returned an error (${res.status}). Try again.`, 502);
  }

  const retrieved = new Set<string>();
  let text = "";
  let announcedWriting = false;
  try {
    for await (const ev of sseEvents(res.body)) {
      if (ev.type === "response.output_item.done" && ev.item?.type === "web_search_call") {
        const action = ev.item.action ?? {};
        if (action.query) onProgress({ type: "search", query: action.query });
        if (action.url) retrieved.add(normalizeUrl(action.url));
        for (const s of action.sources ?? []) if (s.url) retrieved.add(normalizeUrl(s.url));
      } else if (ev.type === "response.output_text.annotation.added" && ev.annotation?.url) {
        retrieved.add(normalizeUrl(ev.annotation.url));
      } else if (ev.type === "response.output_text.delta" && !announcedWriting) {
        announcedWriting = true;
        onProgress({ type: "writing" });
      } else if (ev.type === "response.completed") {
        text = (ev.response?.output ?? [])
          .filter((o) => o.type === "message")
          .flatMap((o) => o.content ?? [])
          .map((c) => c.text ?? "")
          .join("\n")
          .trim();
      } else if (ev.type === "response.failed" || ev.type === "error") {
        throw new ResearchError(`${name} stopped partway through. Try again.`, 502);
      }
    }
  } catch (err) {
    if (err instanceof ResearchError) throw err;
    throw new ResearchError(`${name} took too long or the connection dropped. Try again.`, 504);
  }
  if (!text) throw new ResearchError(`${name} returned an empty answer. Try again.`, 502);
  return { text, retrieved };
}

/** A request (Grok or ChatGPT) without web search, for conversation and reasoning over text the app already has. */
export async function ask<T>(tokens: GrokTokens, instructions: string, messages: { role: "user" | "assistant"; content: string }[], schema: ZodType<T>): Promise<T> {
  const base = [{ role: "system", content: instructions }, ...messages];
  const first = await callGrok(tokens, { input: base }, () => {});
  const parsed = parse(first.text, schema);
  if (parsed.ok) return parsed.value;
  const repair = await callGrok(
    tokens,
    {
      input: [
        ...base,
        { role: "assistant", content: first.text },
        { role: "user", content: `That reply did not match the required JSON format: ${parsed.error}\nReturn only the corrected JSON object.` },
      ],
    },
    () => {},
  );
  const reparsed = parse(repair.text, schema);
  if (reparsed.ok) return reparsed.value;
  console.error("grok JSON invalid after repair:", reparsed.error);
  throw new ResearchError(`${PROVIDER_LABEL[tokens.provider]}'s answer was not in a usable format. Try again.`, 502);
}

/**
 * Runs one web-grounded Grok request and validates the JSON it returns.
 * If the JSON is malformed, Grok gets one chance to fix it without searching again.
 * Returns the set of URLs Grok actually retrieved so callers can drop invented citations.
 */
export async function research<T>(
  tokens: GrokTokens,
  instructions: string,
  prompt: string,
  schema: ZodType<T>,
  onProgress: (p: Progress) => void,
): Promise<{ data: T; retrieved: Set<string> }> {
  const base = [{ role: "system", content: instructions }, { role: "user", content: prompt }];
  const first = await callGrok(tokens, { input: base, tools: [{ type: "web_search" }] }, onProgress);
  const parsed = parse(first.text, schema);
  if (parsed.ok) return { data: parsed.value, retrieved: first.retrieved };

  const repair = await callGrok(
    tokens,
    {
      input: [
        ...base,
        { role: "assistant", content: first.text },
        {
          role: "user",
          content: `That reply did not match the required JSON format: ${parsed.error}\nReturn only the corrected JSON object. Do not add facts or sources that were not in your reply.`,
        },
      ],
    },
    () => {},
  );
  const reparsed = parse(repair.text, schema);
  if (reparsed.ok) return { data: reparsed.value, retrieved: first.retrieved };
  console.error("grok JSON invalid after repair:", reparsed.error);
  throw new ResearchError(`${PROVIDER_LABEL[tokens.provider]}'s answer was not in a usable format. Try again.`, 502);
}

function parse<T>(reply: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = extractJson(reply);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid JSON" };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  };
}
