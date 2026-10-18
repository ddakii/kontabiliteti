-- CreateEnum
CREATE TYPE "FiscalEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "FiscalCouponType" AS ENUM ('SALE', 'CANCEL', 'RETURN');

-- CreateEnum
CREATE TYPE "FiscalReceiptStatus" AS ENUM ('DRAFT', 'READY', 'PROCESSING', 'FISCALIZED', 'REJECTED', 'UNKNOWN', 'NOT_SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalPaymentKind" AS ENUM ('CASH', 'CREDIT_CARD', 'VOUCHER', 'CHEQUE', 'CRYPTO', 'OTHER');

-- CreateTable
CREATE TABLE "FiscalSettings" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL DEFAULT 'TEST',
    "nui" TEXT,
    "fiscalizationNoEnc" TEXT,
    "applicationId" TEXT,
    "businessName" TEXT,
    "defaultUnit" TEXT,
    "itemType" TEXT,
    "nextCouponId" INTEGER NOT NULL DEFAULT 1,
    "connectionCheckedAt" TIMESTAMP(3),
    "connectionOk" BOOLEAN NOT NULL DEFAULT false,
    "connectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalBranch" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "settingsId" UUID NOT NULL,
    "branchNumber" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalPos" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "posNumber" TEXT NOT NULL,
    "keyFingerprint" TEXT,
    "certificatePem" TEXT,
    "certificateNotAfter" TIMESTAMP(3),
    "privateKeyPath" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalPos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalReceipt" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "settingsId" UUID NOT NULL,
    "invoiceId" UUID,
    "posId" UUID NOT NULL,
    "couponId" TEXT NOT NULL,
    "type" "FiscalCouponType" NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "status" "FiscalReceiptStatus" NOT NULL DEFAULT 'READY',
    "verificationNo" TEXT NOT NULL,
    "paymentKind" "FiscalPaymentKind" NOT NULL,
    "detailsBase64" TEXT,
    "signature" TEXT,
    "qrPayload" TEXT,
    "transactionId" TEXT,
    "atkMessage" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(19,2) NOT NULL,
    "payloadSummary" JSONB NOT NULL,
    "originalReceiptId" UUID,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "responseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalAttempt" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalSettings_companyId_key" ON "FiscalSettings"("companyId");

-- CreateIndex
CREATE INDEX "FiscalSettings_firmId_companyId_idx" ON "FiscalSettings"("firmId", "companyId");

-- CreateIndex
CREATE INDEX "FiscalBranch_firmId_companyId_idx" ON "FiscalBranch"("firmId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalBranch_settingsId_branchNumber_key" ON "FiscalBranch"("settingsId", "branchNumber");

-- CreateIndex
CREATE INDEX "FiscalPos_firmId_companyId_idx" ON "FiscalPos"("firmId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPos_branchId_posNumber_key" ON "FiscalPos"("branchId", "posNumber");

-- CreateIndex
CREATE INDEX "FiscalReceipt_firmId_companyId_status_idx" ON "FiscalReceipt"("firmId", "companyId", "status");

-- CreateIndex
CREATE INDEX "FiscalReceipt_companyId_invoiceId_idx" ON "FiscalReceipt"("companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalReceipt_companyId_couponId_key" ON "FiscalReceipt"("companyId", "couponId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalReceipt_companyId_verificationNo_key" ON "FiscalReceipt"("companyId", "verificationNo");

-- CreateIndex
CREATE INDEX "FiscalAttempt_companyId_receiptId_idx" ON "FiscalAttempt"("companyId", "receiptId");

-- AddForeignKey
ALTER TABLE "FiscalSettings" ADD CONSTRAINT "FiscalSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ClientCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalBranch" ADD CONSTRAINT "FiscalBranch_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "FiscalSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalPos" ADD CONSTRAINT "FiscalPos_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "FiscalBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ClientCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "FiscalSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_posId_fkey" FOREIGN KEY ("posId") REFERENCES "FiscalPos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_originalReceiptId_fkey" FOREIGN KEY ("originalReceiptId") REFERENCES "FiscalReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalAttempt" ADD CONSTRAINT "FiscalAttempt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "FiscalReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Një shitje aktive për faturë. Refuzimi dhe mossëndimi lejojnë kupon të ri.
CREATE UNIQUE INDEX "FiscalReceipt_one_active_sale"
ON "FiscalReceipt" ("companyId", "invoiceId")
WHERE "type" = 'SALE'
  AND "invoiceId" IS NOT NULL
  AND "status" IN ('DRAFT', 'READY', 'PROCESSING', 'FISCALIZED', 'UNKNOWN');

-- Një anulim ose kthim aktiv për kuponin origjinal.
CREATE UNIQUE INDEX "FiscalReceipt_one_active_adjustment"
ON "FiscalReceipt" ("originalReceiptId")
WHERE "originalReceiptId" IS NOT NULL
  AND "status" IN ('DRAFT', 'READY', 'PROCESSING', 'FISCALIZED', 'UNKNOWN');

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'fiscal.read', 'Lexon fiskalizimin ATK'),
  (gen_random_uuid(), 'fiscal.configure', 'Konfiguron fiskalizimin ATK'),
  (gen_random_uuid(), 'fiscal.submit', 'Dërgon kuponë fiskalë te ATK')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON (
  (r."key" IN ('OWNER', 'SENIOR_ACCOUNTANT', 'ACCOUNTANT') AND p."key" IN ('fiscal.read', 'fiscal.configure', 'fiscal.submit'))
  OR (r."key" IN ('ASSISTANT', 'AUDITOR') AND p."key" = 'fiscal.read')
)
WHERE r."scopeKey" = 'system'
ON CONFLICT DO NOTHING;
