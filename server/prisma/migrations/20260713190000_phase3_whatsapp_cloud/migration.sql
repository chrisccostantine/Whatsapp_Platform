CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED','CONNECTING','CONNECTED','ERROR');
CREATE TYPE "WhatsAppTemplateCategory" AS ENUM ('MARKETING','UTILITY','AUTHENTICATION');
CREATE TYPE "WhatsAppTemplateStatus" AS ENUM ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED');
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING','PROCESSING','PROCESSED','FAILED');

CREATE TABLE "WhatsAppAccount" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL UNIQUE REFERENCES "Business"("id") ON DELETE CASCADE,
  "whatsAppBusinessAccountId" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL UNIQUE,
  "displayPhoneNumber" TEXT NOT NULL,
  "verifiedName" TEXT,
  "encryptedAccessToken" TEXT NOT NULL,
  "encryptedVerifyToken" TEXT NOT NULL,
  "metaAppId" TEXT,
  "connectionStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'CONNECTING',
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "disconnectedAt" TIMESTAMP(3)
);
CREATE INDEX "WhatsAppAccount_businessId_connectionStatus_idx" ON "WhatsAppAccount"("businessId","connectionStatus");
CREATE INDEX "WhatsAppAccount_whatsAppBusinessAccountId_idx" ON "WhatsAppAccount"("whatsAppBusinessAccountId");

CREATE TABLE "WhatsAppTemplate" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "accountId" UUID NOT NULL REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE,
  "metaTemplateId" TEXT,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "category" "WhatsAppTemplateCategory" NOT NULL,
  "status" "WhatsAppTemplateStatus" NOT NULL,
  "header" JSONB,
  "body" TEXT NOT NULL,
  "footer" TEXT,
  "buttons" JSONB,
  "variables" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("accountId","name","language"),
  UNIQUE("businessId","metaTemplateId")
);
CREATE INDEX "WhatsAppTemplate_businessId_status_idx" ON "WhatsAppTemplate"("businessId","status");

CREATE TABLE "WhatsAppWebhookEvent" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "accountId" UUID NOT NULL REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE,
  "eventKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("accountId","eventKey")
);
CREATE INDEX "WhatsAppWebhookEvent_businessId_status_createdAt_idx" ON "WhatsAppWebhookEvent"("businessId","status","createdAt");

ALTER TABLE "Message" ADD COLUMN "whatsAppAccountId" UUID REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL;
ALTER TABLE "Message" ADD COLUMN "templateId" UUID REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL;
ALTER TABLE "Message" ADD COLUMN "templateName" TEXT;
ALTER TABLE "Message" ADD COLUMN "templateCategory" "WhatsAppTemplateCategory";
CREATE INDEX "Message_businessId_whatsAppAccountId_idx" ON "Message"("businessId","whatsAppAccountId");
ALTER TABLE "MessageAttachment" ADD COLUMN "providerMediaId" TEXT;
ALTER TABLE "MessageAttachment" ADD COLUMN "checksum" TEXT;
