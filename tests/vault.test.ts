import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { loadGrokTokens, seal, storeGrokTokens, unseal, usableGrokTokens } from "../lib/grok/vault";
import { testDb } from "./sqlite-db";

const KEY = randomBytes(32).toString("base64");
const tokens = (expiresAt: number, tag = "a") => ({ provider: "grok" as const, accessToken: `access-${tag}`, refreshToken: `refresh-${tag}`, expiresAt });

describe("grok token vault", () => {
  it("round-trips and refuses another account's blob or a different key", async () => {
    const sealed = await seal(tokens(5), KEY, "user-1");
    expect(sealed).not.toContain("access-a");
    expect(await unseal(sealed, KEY, "user-1")).toEqual(tokens(5));
    expect(await unseal(sealed, KEY, "user-2")).toBeNull();
    expect(await unseal(sealed, randomBytes(32).toString("base64"), "user-1")).toBeNull();
  });

  it("refreshes near expiry and stores the new tokens", async () => {
    const db = testDb();
    const { user } = await signUp(db, "a@example.com", "a long password", 1);
    await storeGrokTokens(db, KEY, user.id, tokens(1000), 0);
    const fresh = await usableGrokTokens(db, KEY, user.id, async () => tokens(10_000_000, "b"), 1000);
    expect(fresh?.accessToken).toBe("access-b");
    expect((await loadGrokTokens(db, KEY, user.id))?.accessToken).toBe("access-b");
  });

  it("uses tokens another job refreshed when its own refresh loses the race", async () => {
    const db = testDb();
    const { user } = await signUp(db, "a@example.com", "a long password", 1);
    await storeGrokTokens(db, KEY, user.id, tokens(1000), 0);
    const got = await usableGrokTokens(db, KEY, user.id, async () => {
      await storeGrokTokens(db, KEY, user.id, tokens(10_000_000, "other"), 0);
      throw new Error("refresh token already used");
    }, 1000);
    expect(got?.accessToken).toBe("access-other");
  });

  it("reads connections sealed before ChatGPT support as Grok and keeps ChatGPT ones", async () => {
    const legacy = { accessToken: "a", refreshToken: "r", expiresAt: 5 };
    expect((await unseal(await seal(legacy as never, KEY, "user-1"), KEY, "user-1"))?.provider).toBe("grok");
    expect((await unseal(await seal({ ...tokens(5), provider: "codex" }, KEY, "user-1"), KEY, "user-1"))?.provider).toBe("codex");
  });

  it("returns null when not connected", async () => {
    expect(await usableGrokTokens(testDb(), KEY, "nobody", async (t) => t)).toBeNull();
  });
});
