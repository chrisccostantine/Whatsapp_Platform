CREATE TYPE "ConversationStatus" AS ENUM ('OPEN','PENDING','RESOLVED','ARCHIVED');
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP','MOCK_WHATSAPP');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND');
CREATE TYPE "MessageType" AS ENUM ('TEXT','IMAGE','DOCUMENT','AUDIO');
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED','SENT','DELIVERED','READ','FAILED','RECEIVED');
ALTER TYPE "ActivityType" ADD VALUE 'CONVERSATION_ASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_RECEIVED';

CREATE TABLE "Conversation" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "assignedUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "channel" "ConversationChannel" NOT NULL DEFAULT 'MOCK_WHATSAPP',
  "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "lastMessagePreview" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastCustomerMessageAt" TIMESTAMP(3),
  "sessionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  UNIQUE("businessId","customerId","channel")
);
CREATE INDEX "Conversation_businessId_status_lastMessageAt_idx" ON "Conversation"("businessId","status","lastMessageAt");
CREATE INDEX "Conversation_businessId_assignedUserId_status_idx" ON "Conversation"("businessId","assignedUserId","status");
CREATE INDEX "Conversation_businessId_customerId_idx" ON "Conversation"("businessId","customerId");

CREATE TABLE "ConversationAssignment" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "conversationId" UUID NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "assignedUserId" UUID NOT NULL REFERENCES "User"("id"),
  "assignedById" UUID NOT NULL REFERENCES "User"("id"),
  "unassignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ConversationAssignment_businessId_conversationId_createdAt_idx" ON "ConversationAssignment"("businessId","conversationId","createdAt");
CREATE INDEX "ConversationAssignment_businessId_assignedUserId_unassignedAt_idx" ON "ConversationAssignment"("businessId","assignedUserId","unassignedAt");

CREATE TABLE "Message" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "conversationId" UUID NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "senderUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "replyToId" UUID REFERENCES "Message"("id") ON DELETE SET NULL,
  "providerMessageId" TEXT,
  "idempotencyKey" TEXT,
  "direction" "MessageDirection" NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  "status" "MessageStatus" NOT NULL,
  "body" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("businessId","providerMessageId"),
  UNIQUE("businessId","idempotencyKey")
);
CREATE INDEX "Message_businessId_conversationId_createdAt_idx" ON "Message"("businessId","conversationId","createdAt");
CREATE INDEX "Message_businessId_status_idx" ON "Message"("businessId","status");

CREATE TABLE "MessageAttachment" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "messageId" UUID NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MessageAttachment_businessId_messageId_idx" ON "MessageAttachment"("businessId","messageId");

CREATE TABLE "InternalNote" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "conversationId" UUID NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "authorId" UUID NOT NULL REFERENCES "User"("id"),
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX "InternalNote_businessId_conversationId_createdAt_idx" ON "InternalNote"("businessId","conversationId","createdAt");
