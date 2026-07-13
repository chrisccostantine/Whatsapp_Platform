import { prisma } from "../../lib/prisma.js";
import { decryptSecret } from "../../lib/encryption.js";
import { AppError } from "../../lib/errors.js";
import { WhatsAppCloudProvider } from "./cloud.provider.js";

export async function getConnectedAccount(businessId: string) {
  const account = await prisma.whatsAppAccount.findFirst({ where: { businessId, connectionStatus: "CONNECTED" } });
  if (!account) throw new AppError(409, "WHATSAPP_NOT_CONNECTED", "Connect a WhatsApp account before sending messages");
  return account;
}
export async function getCloudProvider(businessId: string) {
  const account = await getConnectedAccount(businessId);
  return { account, provider: new WhatsAppCloudProvider(account.phoneNumberId, decryptSecret(account.encryptedAccessToken)) };
}
