CREATE TYPE "CatalogItemType" AS ENUM ('PRODUCT','SERVICE');
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT','SENT','VIEWED','ACCEPTED','REJECTED','EXPIRED','CONVERTED');
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED');
CREATE TYPE "OrderStatus" AS ENUM ('NEW','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','RETURNED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY','CASH','CARD','BANK_TRANSFER','WHISH','OMT','OTHER');

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'QUOTATION_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'INVOICE_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ORDER_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ORDER_STATUS_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECORDED';

ALTER TABLE "Business" ADD COLUMN "address" TEXT;
ALTER TABLE "Business" ADD COLUMN "email" TEXT;
ALTER TABLE "Business" ADD COLUMN "website" TEXT;
ALTER TABLE "Business" ADD COLUMN "taxNumber" TEXT;

CREATE TABLE "DocumentSequence" (
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("businessId","key")
);

CREATE TABLE "Product" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "type" "CatalogItemType" NOT NULL,
  "description" TEXT,
  "price" DECIMAL(14,2) NOT NULL,
  "currency" "Currency" NOT NULL,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  UNIQUE ("businessId","sku")
);
CREATE INDEX "Product_businessId_type_isActive_idx" ON "Product"("businessId","type","isActive");
CREATE INDEX "Product_businessId_name_idx" ON "Product"("businessId","name");

CREATE TABLE "Quotation" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "quotationNumber" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "expiryDate" TIMESTAMP(3) NOT NULL,
  "currency" "Currency" NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "notes" TEXT,
  "terms" TEXT,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  UNIQUE ("businessId","quotationNumber")
);
CREATE INDEX "Quotation_businessId_status_issueDate_idx" ON "Quotation"("businessId","status","issueDate");
CREATE INDEX "Quotation_businessId_customerId_createdAt_idx" ON "Quotation"("businessId","customerId","createdAt");

CREATE TABLE "QuotationItem" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "quotationId" UUID NOT NULL REFERENCES "Quotation"("id") ON DELETE CASCADE,
  "productId" UUID REFERENCES "Product"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "QuotationItem_businessId_quotationId_idx" ON "QuotationItem"("businessId","quotationId");
CREATE INDEX "QuotationItem_businessId_productId_idx" ON "QuotationItem"("businessId","productId");

CREATE TABLE "Invoice" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "sourceQuotationId" UUID UNIQUE REFERENCES "Quotation"("id") ON DELETE SET NULL,
  "invoiceNumber" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "currency" "Currency" NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amountDue" DECIMAL(14,2) NOT NULL,
  "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "notes" TEXT,
  "terms" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  UNIQUE ("businessId","invoiceNumber")
);
CREATE INDEX "Invoice_businessId_paymentStatus_dueDate_idx" ON "Invoice"("businessId","paymentStatus","dueDate");
CREATE INDEX "Invoice_businessId_customerId_createdAt_idx" ON "Invoice"("businessId","customerId","createdAt");

CREATE TABLE "InvoiceItem" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "invoiceId" UUID NOT NULL REFERENCES "Invoice"("id") ON DELETE CASCADE,
  "productId" UUID REFERENCES "Product"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InvoiceItem_businessId_invoiceId_idx" ON "InvoiceItem"("businessId","invoiceId");
CREATE INDEX "InvoiceItem_businessId_productId_idx" ON "InvoiceItem"("businessId","productId");

CREATE TABLE "Order" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "assignedUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "sourceQuotationId" UUID UNIQUE REFERENCES "Quotation"("id") ON DELETE SET NULL,
  "orderNumber" TEXT NOT NULL,
  "currency" "Currency" NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "deliveryFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
  "deliveryAddress" TEXT,
  "customerNotes" TEXT,
  "internalNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  UNIQUE ("businessId","orderNumber")
);
CREATE INDEX "Order_businessId_status_createdAt_idx" ON "Order"("businessId","status","createdAt");
CREATE INDEX "Order_businessId_paymentStatus_idx" ON "Order"("businessId","paymentStatus");
CREATE INDEX "Order_businessId_customerId_createdAt_idx" ON "Order"("businessId","customerId","createdAt");
CREATE INDEX "Order_businessId_assignedUserId_status_idx" ON "Order"("businessId","assignedUserId","status");

CREATE TABLE "OrderItem" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "orderId" UUID NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "productId" UUID REFERENCES "Product"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OrderItem_businessId_orderId_idx" ON "OrderItem"("businessId","orderId");
CREATE INDEX "OrderItem_businessId_productId_idx" ON "OrderItem"("businessId","productId");

CREATE TABLE "Payment" (
  "id" UUID PRIMARY KEY,
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "invoiceId" UUID REFERENCES "Invoice"("id") ON DELETE CASCADE,
  "orderId" UUID REFERENCES "Order"("id") ON DELETE CASCADE,
  "recordedById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" "Currency" NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("invoiceId" IS NOT NULL AND "orderId" IS NULL) OR ("invoiceId" IS NULL AND "orderId" IS NOT NULL))
);
CREATE INDEX "Payment_businessId_invoiceId_paidAt_idx" ON "Payment"("businessId","invoiceId","paidAt");
CREATE INDEX "Payment_businessId_orderId_paidAt_idx" ON "Payment"("businessId","orderId","paidAt");
