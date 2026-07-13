CREATE TYPE "MarketingConsentStatus" AS ENUM ('OPTED_IN','OPTED_OUT');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','SCHEDULED','PROCESSING','PAUSED','COMPLETED','CANCELLED','FAILED');
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING','QUEUED','SENT','DELIVERED','READ','REPLIED','FAILED','SKIPPED');

ALTER TABLE "Customer" ADD COLUMN "marketingOptInSource" TEXT;
ALTER TABLE "Customer" ADD COLUMN "marketingOptInAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "consentNotes" TEXT;

CREATE TABLE "ConsentRecord" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "recordedById" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "status" "MarketingConsentStatus" NOT NULL,
  "source" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ConsentRecord_businessId_customerId_createdAt_idx" ON "ConsentRecord"("businessId","customerId","createdAt");
CREATE INDEX "ConsentRecord_businessId_status_createdAt_idx" ON "ConsentRecord"("businessId","status","createdAt");

CREATE TABLE "Campaign" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "templateId" UUID NOT NULL REFERENCES "WhatsAppTemplate"("id") ON DELETE RESTRICT,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "audience" JSONB NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  "readCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "replyCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Campaign_businessId_status_createdAt_idx" ON "Campaign"("businessId","status","createdAt");
CREATE INDEX "Campaign_businessId_scheduledAt_idx" ON "Campaign"("businessId","scheduledAt");

CREATE TABLE "CampaignRecipient" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "campaignId" UUID NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "messageId" UUID UNIQUE REFERENCES "Message"("id") ON DELETE SET NULL,
  "phone" TEXT NOT NULL,
  "variables" JSONB,
  "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "queuedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("campaignId","customerId")
);
CREATE INDEX "CampaignRecipient_businessId_status_createdAt_idx" ON "CampaignRecipient"("businessId","status","createdAt");
CREATE INDEX "CampaignRecipient_businessId_customerId_createdAt_idx" ON "CampaignRecipient"("businessId","customerId","createdAt");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId","status");
