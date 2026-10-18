import { Prisma, type TaxTreatmentKind } from '@prisma/client';
import { calculateDocument, toBaseCurrency, type TaxTreatment } from '../domain/invoiceMath';
import { writeAudit } from '../lib/audit';
import { asDate, dateOnly } from '../lib/dates';
import { AppError, badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { accountIdByCode, exchangeRateFor, mappingsFor, postJournal } from './posting';
import type { CompanyActor } from '../types/express';

type LineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatPercent?: string;
  treatment?: TaxTreatment;
  deductible?: boolean;
};

export async function listPurchases(actor: CompanyActor, query: { q?: string; status?: string; page: number; pageSize: number }) {
  const where = {
    firmId: actor.firmId,
    companyId: actor.companyId,
    ...(query.status ? { status: query.status as 'DRAFT' } : {}),
    ...(query.q
      ? {
          OR: [
            { supplierInvoiceNumber: { contains: query.q, mode: 'insensitive' as const } },
            { supplier: { name: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.purchaseInvoice.count({ where }),
    prisma.purchaseInvoice.findMany({
      where,
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, rows };
}

export async function getPurchase(actor: CompanyActor, id: string) {
  const purchase = await prisma.purchaseInvoice.findFirst({
    where: { id, firmId: actor.firmId, companyId: actor.companyId },
    include: { supplier: true, lines: { orderBy: { position: 'asc' } }, documents: true },
  });
  if (!purchase) throw notFound('Fatura e blerjes nuk u gjet.');
  return purchase;
}

export async function createPurchase(
  actor: CompanyActor,
  input: {
    supplierId?: string;
    supplierInvoiceNumber?: string;
    issueDate: string;
    dueDate: string;
    currency?: string;
    notes?: string;
    expenseCategoryId?: string;
    lines: LineInput[];
  },
) {
  if (input.dueDate < input.issueDate) throw badRequest('Data e afatit nuk është e vlefshme.');
  await assertSupplier(actor, input.supplierId);
  const duplicate = await findDuplicate(actor, input);
  const totals = calculateDocument(input.lines.map((line) => ({ ...line, treatment: line.treatment ?? 'STANDARD' })));
  const rate = await exchangeRateFor(prisma, actor.companyId, input.currency ?? 'EUR', input.issueDate);
  const purchase = await prisma.purchaseInvoice.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      supplierId: input.supplierId,
      supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
      status: 'DRAFT',
      issueDate: asDate(input.issueDate),
      dueDate: asDate(input.dueDate),
      currency: input.currency ?? 'EUR',
      exchangeRate: new Prisma.Decimal(rate),
      notes: input.notes,
      expenseCategoryId: input.expenseCategoryId,
      subtotal: new Prisma.Decimal(totals.subtotal),
      vatTotal: new Prisma.Decimal(totals.vatTotal),
      total: new Prisma.Decimal(totals.total),
      createdById: actor.userId,
      lines: {
        create: totals.lines.map((line, index) => ({
          firmId: actor.firmId,
          companyId: actor.companyId,
          position: index + 1,
          description: line.description,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
          taxTreatment: line.treatment as TaxTreatmentKind,
          vatPercent: new Prisma.Decimal(line.vatPercent),
          deductible: input.lines[index]?.deductible !== false && line.treatment !== 'EXEMPT',
          netAmount: new Prisma.Decimal(line.net),
          vatAmount: new Prisma.Decimal(line.vat),
          lineTotal: new Prisma.Decimal(line.lineTotal),
        })),
      },
    },
    include: { lines: true, supplier: true },
  });
  return { purchase, duplicateWarning: duplicate };
}

export async function reviewPurchase(actor: CompanyActor, id: string) {
  const purchase = await prisma.purchaseInvoice.findFirst({
    where: { id, firmId: actor.firmId, companyId: actor.companyId },
  });
  if (!purchase) throw notFound('Fatura e blerjes nuk u gjet.');
  if (purchase.status !== 'DRAFT') {
    throw badRequest('Vetëm fatura e blerjes në draft kalon në shqyrtim.');
  }
  const updated = await prisma.purchaseInvoice.updateMany({
    where: { id, firmId: actor.firmId, companyId: actor.companyId, status: 'DRAFT' },
    data: { status: 'IN_REVIEW' },
  });
  if (updated.count !== 1) throw new AppError('PURCHASE_LOCKED', 409, 'Blerja nuk mund të shqyrtohet.');
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'purchase.reviewed',
    entityType: 'PurchaseInvoice',
    entityId: id,
    summary: `U shqyrtua fatura e blerjes ${purchase.supplierInvoiceNumber ?? id}.`,
  });
  return getPurchase(actor, id);
}

export async function postPurchase(actor: CompanyActor, id: string) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchaseInvoice.findFirst({
      where: { id, firmId: actor.firmId, companyId: actor.companyId },
      include: { lines: true, supplier: true },
    });
    if (!purchase) throw notFound('Fatura e blerjes nuk u gjet.');
    if (!['DRAFT', 'IN_REVIEW'].includes(purchase.status)) {
      throw new AppError('PURCHASE_LOCKED', 409, 'Blerja e postuar nuk mbishkruhet.');
    }
    if (!purchase.supplierId || !purchase.supplierInvoiceNumber) {
      throw badRequest('Furnitori dhe numri i faturës së furnitorit janë të detyrueshëm para postimit.');
    }
    const duplicate = await tx.purchaseInvoice.findFirst({
      where: {
        companyId: actor.companyId,
        supplierId: purchase.supplierId,
        supplierInvoiceNumber: purchase.supplierInvoiceNumber,
        NOT: { id: purchase.id },
      },
    });
    if (duplicate) throw new AppError('DUPLICATE_PURCHASE', 409, 'Kjo faturë furnitori duket e regjistruar tashmë.');

    const totals = calculateDocument(
      purchase.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        vatPercent: line.vatPercent.toString(),
        treatment: line.taxTreatment,
      })),
    );
    const deductibleVat = purchase.lines.reduce((sum, line) => {
      return line.deductible ? sum.plus(line.vatAmount.toString()) : sum;
    }, new Prisma.Decimal(0));
    const base = toBaseCurrency(totals.total, deductibleVat.toString(), purchase.exchangeRate.toString());
    const { mappings } = await mappingsFor(tx, actor.companyId);
    const category = purchase.expenseCategoryId
      ? await tx.expenseCategory.findFirst({ where: { id: purchase.expenseCategoryId, companyId: actor.companyId } })
      : null;
    const expenseCode = category?.accountId
      ? (await tx.account.findFirst({ where: { id: category.accountId, companyId: actor.companyId } }))?.code
      : mappings.expenseDefault;
    const expense = await accountIdByCode(tx, actor.companyId, expenseCode || mappings.expenseDefault);
    const inputVat = await accountIdByCode(tx, actor.companyId, mappings.inputVat);
    const payable = await accountIdByCode(tx, actor.companyId, mappings.accountsPayable);
    const journalLines = [
      { accountId: expense, debit: base.net, credit: '0.00', description: purchase.supplierInvoiceNumber },
      { accountId: payable, debit: '0.00', credit: base.total, description: purchase.supplierInvoiceNumber },
    ];
    if (Number(base.vat) > 0) {
      journalLines.splice(1, 0, {
        accountId: inputVat,
        debit: base.vat,
        credit: '0.00',
        description: purchase.supplierInvoiceNumber,
      });
    }
    const locked = await tx.purchaseInvoice.updateMany({
      where: { id, status: { in: ['DRAFT', 'IN_REVIEW'] }, firmId: actor.firmId, companyId: actor.companyId },
      data: {
        status: 'POSTED',
        subtotal: new Prisma.Decimal(totals.subtotal),
        vatTotal: new Prisma.Decimal(totals.vatTotal),
        total: new Prisma.Decimal(totals.total),
        postedAt: new Date(),
        postedById: actor.userId,
      },
    });
    if (locked.count !== 1) throw new AppError('PURCHASE_LOCKED', 409, 'Blerja nuk mund të postohet.');
    const posted = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: dateOnly(purchase.issueDate),
      description: `Blerje ${purchase.supplierInvoiceNumber}`,
      sourceType: 'PURCHASE',
      sourceId: id,
      createdById: actor.userId,
      lines: journalLines,
    });
    await tx.purchaseInvoice.update({ where: { id }, data: { journalEntryId: posted.entry.id } });
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'purchase.posted',
        entityType: 'PurchaseInvoice',
        entityId: id,
        summary: `U postua blerja ${purchase.supplierInvoiceNumber}.`,
        sensitive: true,
      },
      tx,
    );
    return tx.purchaseInvoice.findFirst({ where: { id }, include: { lines: true, supplier: true } });
  });
}

async function assertSupplier(actor: CompanyActor, supplierId?: string) {
  if (!supplierId) return;
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, firmId: actor.firmId, companyId: actor.companyId },
  });
  if (!supplier) throw notFound('Furnitori nuk u gjet.');
}

async function findDuplicate(
  actor: CompanyActor,
  input: { supplierId?: string; supplierInvoiceNumber?: string; issueDate: string; lines: LineInput[] },
) {
  if (input.supplierId && input.supplierInvoiceNumber) {
    const exact = await prisma.purchaseInvoice.findFirst({
      where: {
        companyId: actor.companyId,
        supplierId: input.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
      },
    });
    if (exact) return 'Numri i faturës së këtij furnitori ekziston.';
  }
  return null;
}
