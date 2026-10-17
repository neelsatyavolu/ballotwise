import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
// OWASP's floor for scrypt. The cost is stored with each hash, so raising it later keeps old hashes checkable.
const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

type Cost = { N: number; r: number; p: number };

function derive(password: string, salt: Buffer, cost: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY_BYTES }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** A salted, slow hash of the password, safe to store. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return [SCHEME, COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** True when `password` is the one `stored` was made from. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== SCHEME || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  if (expected.length !== KEY_BYTES) return false;
  try {
    const given = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
    return timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
