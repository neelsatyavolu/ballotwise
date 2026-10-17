import { describe, expect, it } from "vitest";
import { finishReset, requestReset, signIn, signUp, endSession, userForSession, SESSION_TTL_MS, RESET_TTL_MS } from "../lib/auth/accounts";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { testDb } from "./sqlite-db";

const NOW = 1_800_000_000_000;

describe("passwords", () => {
  it("verifies the right password and rejects others and malformed hashes", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$1$1$$")).toBe(false);
  });
});

describe("accounts", () => {
  it("signs up, signs in case-insensitively, and resolves sessions", async () => {
    const db = testDb();
    const { user, token } = await signUp(db, "voter@example.com", "a long password", NOW);
    expect(await userForSession(db, token, NOW)).toEqual(user);
    const again = await signIn(db, "VOTER@example.com", "a long password", NOW);
    expect(again.user.id).toBe(user.id);
    expect(await userForSession(db, token, NOW + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("refuses a duplicate email", async () => {
    const db = testDb();
    await signUp(db, "a@example.com", "a long password", NOW);
    await expect(signUp(db, "A@example.com", "another password", NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a wrong password and locks out after repeated failures", async () => {
    const db = testDb();
    await signUp(db, "a@example.com", "a long password", NOW);
    for (let i = 0; i < 10; i++) await expect(signIn(db, "a@example.com", "nope", NOW)).rejects.toMatchObject({ status: 401 });
    await expect(signIn(db, "a@example.com", "a long password", NOW)).rejects.toMatchObject({ status: 429 });
    expect((await signIn(db, "a@example.com", "a long password", NOW + 16 * 60_000)).user.email).toBe("a@example.com");
  });

  it("ends a session on sign out", async () => {
    const db = testDb();
    const { token } = await signUp(db, "a@example.com", "a long password", NOW);
    await endSession(db, token);
    expect(await userForSession(db, token, NOW)).toBeNull();
  });
});

describe("password reset", () => {
  it("resets once, signs out old sessions, and accepts the new password", async () => {
    const db = testDb();
    const { token: oldSession } = await signUp(db, "a@example.com", "old password!", NOW);
    const reset = await requestReset(db, "A@example.com", NOW);
    expect(reset?.email).toBe("a@example.com");
    const done = await finishReset(db, reset!.token, "new password!", NOW + 1000);
    expect(await userForSession(db, oldSession, NOW + 1000)).toBeNull();
    expect(await userForSession(db, done.token, NOW + 1000)).not.toBeNull();
    await expect(finishReset(db, reset!.token, "again password", NOW + 2000)).rejects.toMatchObject({ status: 400 });
    await expect(signIn(db, "a@example.com", "old password!", NOW + 3000)).rejects.toMatchObject({ status: 401 });
    expect((await signIn(db, "a@example.com", "new password!", NOW + 3000)).user.email).toBe("a@example.com");
  });

  it("only the newest link works, and links expire after an hour", async () => {
    const db = testDb();
    await signUp(db, "a@example.com", "old password!", NOW);
    const first = await requestReset(db, "a@example.com", NOW);
    const second = await requestReset(db, "a@example.com", NOW);
    await expect(finishReset(db, first!.token, "new password!", NOW)).rejects.toMatchObject({ status: 400 });
    await expect(finishReset(db, second!.token, "new password!", NOW + RESET_TTL_MS + 1)).rejects.toMatchObject({ status: 400 });
  });

  it("returns nothing for unknown emails and rate-limits requests", async () => {
    const db = testDb();
    expect(await requestReset(db, "nobody@example.com", NOW)).toBeNull();
    await signUp(db, "a@example.com", "old password!", NOW);
    for (let i = 0; i < 3; i++) expect(await requestReset(db, "a@example.com", NOW)).not.toBeNull();
    expect(await requestReset(db, "a@example.com", NOW)).toBeNull();
  });
});
