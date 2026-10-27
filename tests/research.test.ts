import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ask, ResearchError } from "../lib/grok/research";

const reply = (text: string) =>
  new Response(`data: ${JSON.stringify({ type: "response.completed", response: { output: [{ type: "message", content: [{ text }] }] } })}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("provider routing", () => {
  it("sends ChatGPT accounts to the Codex backend with instructions split out", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("models.json")) return new Response("{}", { status: 404 });
      calls.push({ url: String(url), init: init! });
      return reply('{"ok":true}');
    });
    const tokens = { provider: "codex" as const, accessToken: "t", refreshToken: "r", expiresAt: 0, accountId: "acct" };
    expect(await ask(tokens, "Be brief.", [{ role: "user", content: "hi" }], z.object({ ok: z.boolean() }))).toEqual({ ok: true });

    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["chatgpt-account-id"]).toBe("acct");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.instructions).toBe("Be brief.");
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
    expect(body).toMatchObject({ store: false, stream: true });
  });

  it("keeps Grok accounts on xAI and names the provider in errors", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (String(url).includes("models.json")) return new Response("{}", { status: 404 });
      urls.push(String(url));
      return new Response("no", { status: 401 });
    });
    const grok = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: 0 };
    await expect(ask(grok, "x", [], z.object({}))).rejects.toThrow(new ResearchError("Grok rejected this session. Reconnect Grok.", 401));
    expect(urls[0]).toBe("https://api.x.ai/v1/responses");
    await expect(ask({ ...grok, provider: "codex" }, "x", [], z.object({}))).rejects.toThrow("ChatGPT rejected this session. Reconnect ChatGPT.");
  });

  it("explains an account with no plan or credits instead of asking to try again", async () => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (String(url).includes("models.json")) return new Response("{}", { status: 404 });
      return new Response('{"code":"personal-team-blocked:spending-limit"}', { status: 402 });
    });
    const grok = { provider: "grok" as const, accessToken: "t", refreshToken: "r", expiresAt: 0 };
    await expect(ask(grok, "x", [], z.object({}))).rejects.toThrow(
      new ResearchError("Your Grok account needs a SuperGrok subscription or credits to run research. Add them at grok.com, or connect ChatGPT instead.", 402),
    );
  });
});
