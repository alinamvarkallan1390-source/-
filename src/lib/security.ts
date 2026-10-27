import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, cost = SCRYPT_N): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAXMEM },
      (error, result) => {
        if (error) reject(error);
        else resolve(result as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, costString, saltText, keyText] = stored.split("$");
  if (algorithm !== "scrypt" || !costString || !saltText || !keyText) return false;
  const cost = Number(costString);
  if (!Number.isInteger(cost) || cost < 16_384 || cost > 262_144) return false;

  try {
    const expected = Buffer.from(keyText, "base64url");
    const actual = await deriveKey(password, Buffer.from(saltText, "base64url"), cost);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeHashEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
