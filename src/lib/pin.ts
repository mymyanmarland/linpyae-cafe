import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";

/** Hash a staff PIN with scrypt. Pure node:crypto — safe to import outside Next.js (e.g. seed scripts). */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split(":");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const derived = scryptSync(pin, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
