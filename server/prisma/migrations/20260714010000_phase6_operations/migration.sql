CREATE TYPE "NotificationType" AS ENUM ('NEW_MESSAGE', 'CONVERSATION_ASSIGNED', 'LEAD_ASSIGNED', 'FOLLOW_UP_DUE', 'FOLLOW_UP_OVERDUE', 'QUOTATION_ACCEPTED', 'INVOICE_OVERDUE', 'CAMPAIGN_COMPLETED', 'WHATSAPP_CONNECTION_PROBLEM');

CREATE TABLE "Notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "enabledTypes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_businessId_userId_dedupeKey_key" ON "Notification"("businessId", "userId", "dedupeKey");
CREATE INDEX "Notification_businessId_userId_readAt_createdAt_idx" ON "Notification"("businessId", "userId", "readAt", "createdAt");
CREATE INDEX "Notification_businessId_type_createdAt_idx" ON "Notification"("businessId", "type", "createdAt");
CREATE UNIQUE INDEX "NotificationPreference_businessId_userId_key" ON "NotificationPreference"("businessId", "userId");
CREATE INDEX "NotificationPreference_businessId_userId_idx" ON "NotificationPreference"("businessId", "userId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
