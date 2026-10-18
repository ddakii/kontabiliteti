ALTER TABLE "JournalEntryLine"
  ADD CONSTRAINT "journal_line_nonnegative" CHECK (debit >= 0 AND credit >= 0);

ALTER TABLE "JournalEntryLine"
  ADD CONSTRAINT "journal_line_one_side" CHECK (NOT (debit > 0 AND credit > 0));

ALTER TABLE "PaymentAllocation"
  ADD CONSTRAINT "allocation_one_document" CHECK (
    (CASE WHEN "invoiceId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "purchaseInvoiceId" IS NULL THEN 0 ELSE 1 END) = 1
  );

CREATE UNIQUE INDEX "tax_rate_template_code"
  ON "TaxRate" ("code")
  WHERE "isTemplate" = true AND "companyId" IS NULL;
