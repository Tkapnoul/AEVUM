import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// The parts of node:crypto the server uses, on Web Crypto (+ a synchronous SHA-256).

class Bytes {
  constructor(private b: Uint8Array) {}
  toString(enc: "hex" | "base64" | "base64url" = "hex") {
    if (enc === "hex") return bytesToHex(this.b);
    const b64 = btoa(String.fromCharCode(...this.b));
    return enc === "base64" ? b64 : b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

export const randomUUID = () => crypto.randomUUID();

export function randomBytes(n: number) {
  return new Bytes(crypto.getRandomValues(new Uint8Array(n)));
}

/** Uniform integer in [0, max), rejection-sampled. */
export function randomInt(max: number) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a);
  while (a[0] >= limit);
  return a[0] % max;
}

export function createHash(alg: string) {
  if (alg !== "sha256") throw new Error(`hash ${alg} not available`);
  let data = "";
  const h = {
    update(s: string) {
      data += s;
      return h;
    },
    digest: (_enc: "hex") => bytesToHex(sha256(utf8ToBytes(data))),
  };
  return h;
}
