import { Prisma } from '@prisma/client';
import { nextReceivableStatus, validateAllocations } from '../domain/payments';
import { reverseLines } from '../domain/journal';
import { writeAudit } from '../lib/audit';
import { asDate, dateOnly, todayISO } from '../lib/dates';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { accountIdByCode, exchangeRateFor, mappingsFor, postJournal } from './posting';
import type { CompanyActor } from '../types/express';

type AllocationInput = { invoiceId?: string; purchaseInvoiceId?: string; amount: string };

export async function listPayments(actor: CompanyActor, query: { page: number; pageSize: number }) {
  const where = { firmId: actor.firmId, companyId: actor.companyId };
  const [total, rows] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { allocations: true, customer: true, supplier: true, bankAccount: true },
      orderBy: { date: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, rows };
}

export async function createPayment(
  actor: CompanyActor,
  input: {
    direction: 'INCOMING' | 'OUTGOING';
    amount: string;
    date: string;
    method: 'BANK' | 'CASH' | 'OTHER';
    currency?: string;
    bankAccountId?: string;
    customerId?: string;
    supplierId?: string;
    reference?: string;
    notes?: string;
    allocations: AllocationInput[];
  },
) {
  return prisma.$transaction(async (tx) => {
    const targets = [];
    for (const allocation of input.allocations) {
      if (allocation.invoiceId && allocation.purchaseInvoiceId) {
        throw badRequest('Shpërndarja lidhet vetëm me një dokument.');
      }
      if (input.direction === 'INCOMING') {
        if (!allocation.invoiceId) throw badRequest('Arkëtimi shpërndahet te një faturë shitjeje.');
        const invoice = await tx.invoice.findFirst({
          where: { id: allocation.invoiceId, firmId: actor.firmId, companyId: actor.companyId },
        });
        if (!invoice || invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') throw notFound('Fatura nuk u gjet.');
        const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid).minus(invoice.amountCredited);
        targets.push({ allocation, outstanding: outstanding.toString(), invoice });
      } else {
        if (!allocation.purchaseInvoiceId) throw badRequest('Pagesa shpërndahet te një faturë blerjeje.');
        const purchase = await tx.purchaseInvoice.findFirst({
          where: { id: allocation.purchaseInvoiceId, firmId: actor.firmId, companyId: actor.companyId },
        });
        if (!purchase || !['POSTED', 'PARTIALLY_PAID'].includes(purchase.status)) throw notFound('Blerja nuk u gjet.');
        const outstanding = new Prisma.Decimal(purchase.total).minus(purchase.amountPaid);
        targets.push({ allocation, outstanding: outstanding.toString(), purchase });
      }
    }
    validateAllocations(
      input.amount,
      targets.map((target) => ({ outstanding: target.outstanding, amount: target.allocation.amount })),
    );
    const rate = await exchangeRateFor(tx, actor.companyId, input.currency ?? 'EUR', input.date);
    const bank = input.bankAccountId
      ? await tx.bankAccount.findFirst({
          where: { id: input.bankAccountId, firmId: actor.firmId, companyId: actor.companyId, isActive: true },
        })
      : null;
    if (input.method !== 'OTHER' && !bank) throw badRequest('Zgjidhni llogarinë e bankës ose arkën.');
    const { mappings } = await mappingsFor(tx, actor.companyId);
    const cashCode = bank?.isCash ? mappings.cash : mappings.bank;
    const cashAccountId = bank?.ledgerAccountId ?? (await accountIdByCode(tx, actor.companyId, cashCode));
    const counterCode = input.direction === 'INCOMING' ? mappings.accountsReceivable : mappings.accountsPayable;
    const counterId = await accountIdByCode(tx, actor.companyId, counterCode);
    const baseAmount = new Prisma.Decimal(input.amount).mul(rate).toDecimalPlaces(2);
    const amount = baseAmount.toFixed(2);
    const journalLines =
      input.direction === 'INCOMING'
        ? [
            { accountId: cashAccountId, debit: amount, credit: '0.00' },
            { accountId: counterId, debit: '0.00', credit: amount },
          ]
        : [
            { accountId: counterId, debit: amount, credit: '0.00' },
            { accountId: cashAccountId, debit: '0.00', credit: amount },
          ];
    const payment = await tx.payment.create({
      data: {
        firmId: actor.firmId,
        companyId: actor.companyId,
        direction: input.direction,
        amount: new Prisma.Decimal(input.amount),
        date: asDate(input.date),
        method: input.method,
        currency: input.currency ?? 'EUR',
        exchangeRate: new Prisma.Decimal(rate),
        bankAccountId: bank?.id,
        customerId: input.customerId,
        supplierId: input.supplierId,
        reference: input.reference,
        notes: input.notes,
        createdById: actor.userId,
      },
    });
    const posted = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: input.date,
      description: input.direction === 'INCOMING' ? `Arkëtim ${input.reference ?? ''}`.trim() : `Pagesë ${input.reference ?? ''}`.trim(),
      sourceType: 'PAYMENT',
      sourceId: payment.id,
      createdById: actor.userId,
      lines: journalLines,
    });
    await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: posted.entry.id } });
    for (const target of targets) {
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          firmId: actor.firmId,
          companyId: actor.companyId,
          invoiceId: target.allocation.invoiceId,
          purchaseInvoiceId: target.allocation.purchaseInvoiceId,
          amount: new Prisma.Decimal(target.allocation.amount),
        },
      });
      if (target.invoice) {
        const amountPaid = new Prisma.Decimal(target.invoice.amountPaid).plus(target.allocation.amount);
        const status = nextReceivableStatus({
          total: target.invoice.total.toString(),
          amountPaid: amountPaid.toString(),
          amountCredited: target.invoice.amountCredited.toString(),
          dueDate: dateOnly(target.invoice.dueDate),
          today: todayISO(),
        });
        await tx.invoice.update({ where: { id: target.invoice.id }, data: { amountPaid, status } });
      }
      if (target.purchase) {
        const amountPaid = new Prisma.Decimal(target.purchase.amountPaid).plus(target.allocation.amount);
        const due = new Prisma.Decimal(target.purchase.total).minus(amountPaid);
        const status = due.lte(0) ? 'PAID' : 'PARTIALLY_PAID';
        await tx.purchaseInvoice.update({ where: { id: target.purchase.id }, data: { amountPaid, status } });
      }
    }
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'payment.created',
        entityType: 'Payment',
        entityId: payment.id,
        summary: input.direction === 'INCOMING' ? 'U regjistrua një arkëtim.' : 'U regjistrua një pagesë.',
        sensitive: true,
      },
      tx,
    );
    return tx.payment.findFirst({ where: { id: payment.id }, include: { allocations: true } });
  });
}

export async function reversePayment(actor: CompanyActor, paymentId: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, firmId: actor.firmId, companyId: actor.companyId },
      include: { allocations: true, journalEntry: { include: { lines: true } } },
    });
    if (!payment || !payment.journalEntry) throw notFound('Pagesa nuk u gjet.');
    if (payment.reversedAt) throw badRequest('Pagesa është stornuar tashmë.');
    const reversed = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: todayISO(),
      description: `Stornim pagese ${payment.reference ?? payment.id}`,
      sourceType: 'PAYMENT_REVERSAL',
      sourceId: payment.id,
      createdById: actor.userId,
      lines: reverseLines(
        payment.journalEntry.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit.toString(),
          credit: line.credit.toString(),
        })),
      ),
    });
    await tx.journalEntry.update({
      where: { id: payment.journalEntry.id },
      data: { status: 'REVERSED' },
    });
    await tx.journalEntry.update({
      where: { id: reversed.entry.id },
      data: { reversalOfId: payment.journalEntry.id },
    });
    for (const allocation of payment.allocations) {
      if (allocation.invoiceId) {
        const invoice = await tx.invoice.findFirst({ where: { id: allocation.invoiceId, companyId: actor.companyId } });
        if (!invoice) continue;
        const amountPaid = Prisma.Decimal.max(new Prisma.Decimal(invoice.amountPaid).minus(allocation.amount), new Prisma.Decimal(0));
        const status = nextReceivableStatus({
          total: invoice.total.toString(),
          amountPaid: amountPaid.toString(),
          amountCredited: invoice.amountCredited.toString(),
          dueDate: dateOnly(invoice.dueDate),
          today: todayISO(),
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid, status } });
      }
      if (allocation.purchaseInvoiceId) {
        const purchase = await tx.purchaseInvoice.findFirst({
          where: { id: allocation.purchaseInvoiceId, companyId: actor.companyId },
        });
        if (!purchase) continue;
        const amountPaid = Prisma.Decimal.max(new Prisma.Decimal(purchase.amountPaid).minus(allocation.amount), new Prisma.Decimal(0));
        const status = amountPaid.eq(0) ? 'POSTED' : amountPaid.gte(purchase.total) ? 'PAID' : 'PARTIALLY_PAID';
        await tx.purchaseInvoice.update({ where: { id: purchase.id }, data: { amountPaid, status } });
      }
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { reversedAt: new Date(), reversalJournalEntryId: reversed.entry.id },
    });
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'payment.reversed',
        entityType: 'Payment',
        entityId: payment.id,
        summary: 'Pagesa u stornua dhe historia mbeti në libër.',
        sensitive: true,
      },
      tx,
    );
    return { id: payment.id, reversed: true };
  });
}
