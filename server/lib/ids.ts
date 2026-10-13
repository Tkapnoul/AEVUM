import { randomUUID, randomInt, createHash, randomBytes } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

// No 0/O/1/I so codes typed on a phone are unambiguous.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function pairingCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export const deviceToken = () => `aev_${randomBytes(32).toString("base64url")}`;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
