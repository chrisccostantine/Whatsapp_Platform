import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config/env.js",()=>({env:{ENCRYPTION_KEY:"test-encryption-key-that-is-long-enough-123",META_APP_SECRET:"meta-app-secret"}}));
const {encryptSecret,decryptSecret,verifyMetaSignature}=await import("../src/lib/encryption.js");
import { createHmac } from "node:crypto";
describe("WhatsApp credential security",()=>{
  it("encrypts with authenticated encryption and decrypts exactly",()=>{const encrypted=encryptSecret("EAAB-secret-token");expect(encrypted).not.toContain("EAAB-secret-token");expect(decryptSecret(encrypted)).toBe("EAAB-secret-token");});
  it("rejects tampered ciphertext",()=>{const encrypted=encryptSecret("sensitive");expect(()=>decryptSecret(`${encrypted.slice(0,-2)}aa`)).toThrow();});
  it("verifies Meta SHA-256 webhook signatures",()=>{const body=Buffer.from('{"object":"whatsapp_business_account"}');const signature=`sha256=${createHmac("sha256","meta-app-secret").update(body).digest("hex")}`;expect(verifyMetaSignature(body,signature)).toBe(true);expect(verifyMetaSignature(Buffer.from("changed"),signature)).toBe(false);});
});

