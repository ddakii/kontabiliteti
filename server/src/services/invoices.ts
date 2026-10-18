import { Prisma, type TaxTreatmentKind } from '@prisma/client';
import { calculateDocument, toBaseCurrency, type TaxTreatment } from '../domain/invoiceMath';
import { writeAudit } from '../lib/audit';
import { asDate, dateOnly, todayISO } from '../lib/dates';
import { sendEmail } from '../lib/email';
import { AppError, badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { accountIdByCode, exchangeRateFor, formatDocumentNumber, mappingsFor, nextDocumentNumber, postJournal } from './posting';
import { nextReceivableStatus } from '../domain/payments';
import type { CompanyActor } from '../types/express';

type LineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  vatPercent?: string;
  treatment?: TaxTreatment;
  taxRateId?: string;
};

export async function listInvoices(
  actor: CompanyActor,
  query: { q?: string; status?: string; page: number; pageSize: number },
) {
  const where = {
    firmId: actor.firmId,
    companyId: actor.companyId,
    ...(query.status ? { status: query.status as 'DRAFT' } : {}),
    ...(query.q
      ? {
          OR: [
            { displayNumber: { contains: query.q, mode: 'insensitive' as const } },
            { customer: { name: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    total,
    rows: rows.map((invoice) => ({
      ...invoice,
      amountDue: dueOf(invoice.total.toString(), invoice.amountPaid.toString(), invoice.amountCredited.toString()),
    })),
  };
}

export async function getInvoice(actor: CompanyActor, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, firmId: actor.firmId, companyId: actor.companyId },
    include: {
      customer: true,
      lines: { orderBy: { position: 'asc' } },
      allocations: { include: { payment: true } },
      creditNotes: { include: { lines: true } },
      company: true,
    },
  });
  if (!invoice) throw notFound('Fatura nuk u gjet.');
  return invoice;
}

export async function previewInvoice(actor: CompanyActor, input: { currency?: string; issueDate: string; lines: LineInput[] }) {
  const totals = await resolveLines(actor.companyId, input.lines);
  const rate = await exchangeRateFor(prisma, actor.companyId, input.currency ?? 'EUR', input.issueDate);
  return { ...totals, exchangeRate: rate, base: toBaseCurrency(totals.total, totals.vatTotal, rate) };
}

export async function createInvoice(
  actor: CompanyActor,
  input: {
    customerId?: string;
    issueDate: string;
    dueDate: string;
    currency?: string;
    notes?: string;
    paymentTerms?: string;
    paymentInstructions?: string;
    lines: LineInput[];
  },
) {
  if (input.dueDate < input.issueDate) throw badRequest('Data e afatit nuk mund të jetë para datës së faturës.');
  await assertCustomer(actor, input.customerId);
  const totals = await resolveLines(actor.companyId, input.lines);
  const rate = await exchangeRateFor(prisma, actor.companyId, input.currency ?? 'EUR', input.issueDate);
  const settings = await prisma.companySettings.findUnique({ where: { companyId: actor.companyId } });
  const invoice = await prisma.invoice.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      customerId: input.customerId,
      series: settings?.invoiceSeries ?? 'FAT',
      status: 'DRAFT',
      issueDate: asDate(input.issueDate),
      dueDate: asDate(input.dueDate),
      currency: input.currency ?? 'EUR',
      exchangeRate: new Prisma.Decimal(rate),
      notes: input.notes,
      paymentTerms: input.paymentTerms,
      paymentInstructions: input.paymentInstructions ?? settings?.paymentInstructions,
      subtotal: new Prisma.Decimal(totals.subtotal),
      discountTotal: new Prisma.Decimal(totals.discountTotal),
      taxableBase: new Prisma.Decimal(totals.taxableBase),
      vatTotal: new Prisma.Decimal(totals.vatTotal),
      total: new Prisma.Decimal(totals.total),
      createdById: actor.userId,
      lines: { create: lineWrites(actor, totals.lines) },
    },
    include: { lines: true, customer: true },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'invoice.created',
    entityType: 'Invoice',
    entityId: invoice.id,
    summary: 'U krijua një faturë draft.',
    sensitive: true,
  });
  return invoice;
}

export async function updateDraft(actor: CompanyActor, invoiceId: string, input: Parameters<typeof createInvoice>[1]) {
  const existing = await getInvoice(actor, invoiceId);
  if (existing.status !== 'DRAFT') {
    throw new AppError('INVOICE_LOCKED', 409, 'Fatura e finalizuar nuk mbishkruhet. Përdorni notë krediti.');
  }
  if (input.dueDate < input.issueDate) throw badRequest('Data e afatit nuk mund të jetë para datës së faturës.');
  await assertCustomer(actor, input.customerId);
  const totals = await resolveLines(actor.companyId, input.lines);
  const rate = await exchangeRateFor(prisma, actor.companyId, input.currency ?? 'EUR', input.issueDate);
  return prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        customerId: input.customerId,
        issueDate: asDate(input.issueDate),
        dueDate: asDate(input.dueDate),
        currency: input.currency ?? 'EUR',
        exchangeRate: new Prisma.Decimal(rate),
        notes: input.notes,
        paymentTerms: input.paymentTerms,
        paymentInstructions: input.paymentInstructions,
        subtotal: new Prisma.Decimal(totals.subtotal),
        discountTotal: new Prisma.Decimal(totals.discountTotal),
        taxableBase: new Prisma.Decimal(totals.taxableBase),
        vatTotal: new Prisma.Decimal(totals.vatTotal),
        total: new Prisma.Decimal(totals.total),
        lines: { create: lineWrites(actor, totals.lines) },
      },
      include: { lines: true, customer: true },
    });
  });
}

export async function finalizeInvoice(actor: CompanyActor, invoiceId: string, correlationId?: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, firmId: actor.firmId, companyId: actor.companyId },
      include: { lines: { orderBy: { position: 'asc' } }, customer: true },
    });
    if (!invoice) throw notFound('Fatura nuk u gjet.');
    if (invoice.status !== 'DRAFT') throw new AppError('INVOICE_LOCKED', 409, 'Fatura është finalizuar tashmë.');
    if (!invoice.customerId) throw badRequest('Zgjidhni blerësin para finalizimit.');
    if (invoice.lines.length === 0) throw badRequest('Fatura nuk ka rreshta.');

    const totals = calculateDocument(
      invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        discountPercent: line.discountPercent.toString(),
        vatPercent: line.vatPercent.toString(),
        treatment: line.taxTreatment,
      })),
    );
    const issueDate = dateOnly(invoice.issueDate);
    const rate = invoice.exchangeRate.toString();
    const base = toBaseCurrency(totals.total, totals.vatTotal, rate);
    const { mappings } = await mappingsFor(tx, actor.companyId);
    const receivable = await accountIdByCode(tx, actor.companyId, mappings.accountsReceivable);
    const revenue = await accountIdByCode(tx, actor.companyId, mappings.salesRevenue);
    const outputVat = await accountIdByCode(tx, actor.companyId, mappings.outputVat);
    const year = Number(issueDate.slice(0, 4));
    const number = await nextDocumentNumber(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      docType: 'INVOICE',
      series: invoice.series,
      fiscalYear: year,
    });
    const displayNumber = formatDocumentNumber(invoice.series, year, number);
    const locked = await tx.invoice.updateMany({
      where: { id: invoiceId, firmId: actor.firmId, companyId: actor.companyId, status: 'DRAFT' },
      data: {
        status: 'ISSUED',
        number,
        displayNumber,
        subtotal: new Prisma.Decimal(totals.subtotal),
        discountTotal: new Prisma.Decimal(totals.discountTotal),
        taxableBase: new Prisma.Decimal(totals.taxableBase),
        vatTotal: new Prisma.Decimal(totals.vatTotal),
        total: new Prisma.Decimal(totals.total),
        finalizedAt: new Date(),
        finalizedById: actor.userId,
      },
    });
    if (locked.count !== 1) throw new AppError('INVOICE_LOCKED', 409, 'Fatura nuk mund të finalizohet.');

    const lines = [
      { accountId: receivable, debit: base.total, credit: '0.00', description: displayNumber },
      { accountId: revenue, debit: '0.00', credit: base.net, description: displayNumber },
    ];
    if (Number(base.total) <= 0) throw badRequest('Totali i faturës duhet të jetë më i madh se zero.');
    if (Number(base.vat) > 0) {
      lines.push({ accountId: outputVat, debit: '0.00', credit: base.vat, description: displayNumber });
    }
    const posted = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: issueDate,
      description: `Fatura ${displayNumber}`,
      sourceType: 'INVOICE',
      sourceId: invoiceId,
      createdById: actor.userId,
      lines,
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { journalEntryId: posted.entry.id } });
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'invoice.finalized',
        entityType: 'Invoice',
        entityId: invoiceId,
        summary: `U finalizua fatura ${displayNumber}.`,
        correlationId,
        sensitive: true,
      },
      tx,
    );
    return tx.invoice.findFirst({ where: { id: invoiceId }, include: { lines: true, customer: true } });
  });
}

export async function duplicateInvoice(actor: CompanyActor, invoiceId: string) {
  const invoice = await getInvoice(actor, invoiceId);
  return createInvoice(actor, {
    customerId: invoice.customerId ?? undefined,
    issueDate: todayISO(),
    dueDate: todayISO(),
    currency: invoice.currency,
    notes: invoice.notes ?? undefined,
    paymentTerms: invoice.paymentTerms ?? undefined,
    paymentInstructions: invoice.paymentInstructions ?? undefined,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      discountPercent: line.discountPercent.toString(),
      vatPercent: line.vatPercent.toString(),
      treatment: line.taxTreatment,
    })),
  });
}

export async function createCreditNote(
  actor: CompanyActor,
  invoiceId: string,
  input: { issueDate: string; reason: string; lines: LineInput[] },
) {
  const invoice = await getInvoice(actor, invoiceId);
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
    throw badRequest('Nota e kreditit lidhet me një faturë të finalizuar.');
  }
  const totals = await resolveLines(actor.companyId, input.lines);
  const remaining = Number(invoice.total) - Number(invoice.amountCredited);
  if (Number(totals.total) - remaining > 0.001) {
    throw badRequest('Nota e kreditit e kalon vlerën e pacreditur të faturës.');
  }
  const settings = await prisma.companySettings.findUnique({ where: { companyId: actor.companyId } });
  return prisma.$transaction(async (tx) => {
    const year = Number(input.issueDate.slice(0, 4));
    const series = settings?.creditSeries ?? 'NK';
    const number = await nextDocumentNumber(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      docType: 'CREDIT_NOTE',
      series,
      fiscalYear: year,
    });
    const displayNumber = formatDocumentNumber(series, year, number);
    const rate = await exchangeRateFor(tx, actor.companyId, invoice.currency, input.issueDate);
    const base = toBaseCurrency(totals.total, totals.vatTotal, rate);
    const { mappings } = await mappingsFor(tx, actor.companyId);
    const receivable = await accountIdByCode(tx, actor.companyId, mappings.accountsReceivable);
    const revenue = await accountIdByCode(tx, actor.companyId, mappings.salesRevenue);
    const outputVat = await accountIdByCode(tx, actor.companyId, mappings.outputVat);
    const journalLines = [
      { accountId: revenue, debit: base.net, credit: '0.00', description: displayNumber },
      { accountId: receivable, debit: '0.00', credit: base.total, description: displayNumber },
    ];
    if (Number(base.vat) > 0) journalLines.splice(1, 0, { accountId: outputVat, debit: base.vat, credit: '0.00', description: displayNumber });
    const posted = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: input.issueDate,
      description: `Notë krediti ${displayNumber} për ${invoice.displayNumber ?? 'faturën'}`,
      sourceType: 'CREDIT_NOTE',
      sourceId: invoice.id,
      createdById: actor.userId,
      lines: journalLines,
    });
    const note = await tx.creditNote.create({
      data: {
        firmId: actor.firmId,
        companyId: actor.companyId,
        invoiceId: invoice.id,
        series,
        number,
        displayNumber,
        status: 'ISSUED',
        issueDate: asDate(input.issueDate),
        reason: input.reason,
        subtotal: new Prisma.Decimal(totals.subtotal),
        vatTotal: new Prisma.Decimal(totals.vatTotal),
        total: new Prisma.Decimal(totals.total),
        journalEntryId: posted.entry.id,
        createdById: actor.userId,
        lines: {
          create: totals.lines.map((line) => ({
            firmId: actor.firmId,
            companyId: actor.companyId,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            vatPercent: new Prisma.Decimal(line.vatPercent),
            netAmount: new Prisma.Decimal(line.net),
            vatAmount: new Prisma.Decimal(line.vat),
            lineTotal: new Prisma.Decimal(line.lineTotal),
          })),
        },
      },
    });
    const amountCredited = new Prisma.Decimal(invoice.amountCredited).plus(totals.total);
    const status = nextReceivableStatus({
      total: invoice.total.toString(),
      amountPaid: invoice.amountPaid.toString(),
      amountCredited: amountCredited.toString(),
      dueDate: dateOnly(invoice.dueDate),
      today: todayISO(),
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { amountCredited, status } });
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'invoice.credit_note',
        entityType: 'CreditNote',
        entityId: note.id,
        summary: `U lëshua nota e kreditit ${displayNumber}.`,
        sensitive: true,
      },
      tx,
    );
    return note;
  });
}

export async function emailInvoice(actor: CompanyActor, invoiceId: string, input: { to: string; message?: string }, pdf: Buffer) {
  const invoice = await getInvoice(actor, invoiceId);
  if (invoice.status === 'DRAFT') throw badRequest('Drafti nuk dërgohet me email.');
  const result = await sendEmail({
    to: input.to,
    subject: `Fatura ${invoice.displayNumber ?? ''}`,
    body: input.message || `Ju dërgojmë faturën ${invoice.displayNumber ?? ''}.`,
    firmId: actor.firmId,
    relatedType: 'Invoice',
    relatedId: invoice.id,
    attachment: { filename: `${invoice.displayNumber ?? 'fatura'}.pdf`, content: pdf, contentType: 'application/pdf' },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'invoice.email',
    entityType: 'Invoice',
    entityId: invoice.id,
    summary: result.delivered
      ? `Fatura ${invoice.displayNumber} u dërgua me email.`
      : `Fatura ${invoice.displayNumber} nuk u dërgua sepse emaili nuk është i konfiguruar ose dështoi.`,
    sensitive: true,
  });
  return result;
}

async function resolveLines(companyId: string, lines: LineInput[]) {
  const settings = await prisma.companySettings.findUnique({ where: { companyId } });
  const resolved = [];
  for (const line of lines) {
    let vatPercent = line.vatPercent ?? '0';
    let treatment = line.treatment ?? 'STANDARD';
    if (line.taxRateId) {
      const rate = await prisma.taxRate.findFirst({ where: { id: line.taxRateId, companyId, isActive: true } });
      if (!rate) throw badRequest('Norma e TVSH-së nuk u gjet për këtë kompani.');
      if (!rate.userConfirmedAt && !settings?.allowUnconfirmedTaxRates) {
        throw new AppError(
          'TAX_RATE_UNCONFIRMED',
          409,
          'Norma e TVSH-së duhet konfirmuar nga kontabilisti pasi të verifikohet me legjislacionin aktual.',
        );
      }
      vatPercent = rate.ratePercent.toString();
      treatment = rate.treatment;
    } else if (!settings?.allowUnconfirmedTaxRates && Number(vatPercent) > 0) {
      throw new AppError('TAX_RATE_UNCONFIRMED', 409, 'Zgjidhni një normë të konfirmuar të TVSH-së.');
    }
    resolved.push({ ...line, vatPercent, treatment });
  }
  return calculateDocument(resolved);
}

function lineWrites(actor: CompanyActor, lines: ReturnType<typeof calculateDocument>['lines']) {
  return lines.map((line, index) => ({
    firmId: actor.firmId,
    companyId: actor.companyId,
    position: index + 1,
    description: line.description,
    quantity: new Prisma.Decimal(line.quantity),
    unitPrice: new Prisma.Decimal(line.unitPrice),
    discountPercent: new Prisma.Decimal(line.discountPercent),
    taxTreatment: line.treatment as TaxTreatmentKind,
    vatPercent: new Prisma.Decimal(line.vatPercent),
    netAmount: new Prisma.Decimal(line.net),
    vatAmount: new Prisma.Decimal(line.vat),
    lineTotal: new Prisma.Decimal(line.lineTotal),
  }));
}

async function assertCustomer(actor: CompanyActor, customerId?: string) {
  if (!customerId) return;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, firmId: actor.firmId, companyId: actor.companyId },
  });
  if (!customer) throw notFound('Blerësi nuk u gjet.');
}

function dueOf(total: string, paid: string, credited: string) {
  const due = Number(total) - Number(paid) - Number(credited);
  return due > 0 ? due.toFixed(2) : '0.00';
}

function PrismaDecimalGuard(value: string) {
  return Number(value);
}
void PrismaDecimalGuard;
