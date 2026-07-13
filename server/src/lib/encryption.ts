import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { env } from "../config/env.js";
const key = createHash("sha256").update(env.ENCRYPTION_KEY, "utf8").digest();

export function encryptSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}
export function decryptSecret(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Encrypted secret has an invalid format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined) {
  if (!env.META_APP_SECRET || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex"), "hex");
  const received = Buffer.from(signature.slice(7), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

