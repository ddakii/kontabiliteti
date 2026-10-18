-- CreateEnum
CREATE TYPE "MonthItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "DocumentStatus" ADD VALUE 'APPROVED';
ALTER TYPE "DocumentStatus" ADD VALUE 'PROCESSED';

-- CreateTable
CREATE TABLE "MonthChecklist" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT 'Lista është kontroll operacional. Shënimi i një pike nuk është dorëzim tatimor dhe nuk e mbyll periudhën.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthChecklistItem" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "MonthItemStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" UUID,
    "dueDate" DATE,
    "comment" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,

    CONSTRAINT "MonthChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthChecklist_firmId_companyId_idx" ON "MonthChecklist"("firmId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthChecklist_companyId_periodYear_periodMonth_key" ON "MonthChecklist"("companyId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "MonthChecklistItem_firmId_companyId_idx" ON "MonthChecklistItem"("firmId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthChecklistItem_checklistId_code_key" ON "MonthChecklistItem"("checklistId", "code");

-- AddForeignKey
ALTER TABLE "MonthChecklist" ADD CONSTRAINT "MonthChecklist_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthChecklistItem" ADD CONSTRAINT "MonthChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "MonthChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
