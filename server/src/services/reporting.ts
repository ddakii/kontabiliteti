import ExcelJS from 'exceljs';
import type { CompanyActor } from '../types/express';
import { dateOnly } from '../lib/dates';
import { prisma } from '../lib/prisma';
import { mappingsFor } from './posting';
import { balanceSheet, cashFlowStatement, generalLedger, incomeStatement, trialBalance, type ReportLine } from '../domain/reports';
import { summarizeVat } from '../domain/vat';
import { writeAudit } from '../lib/audit';

export async function postedLines(actor: CompanyActor, from?: string, to?: string): Promise<ReportLine[]> {
  const { mappings } = await mappingsFor(prisma, actor.companyId);
  const banks = await prisma.bankAccount.findMany({
    where: { firmId: actor.firmId, companyId: actor.companyId },
    select: { ledgerAccountId: true },
  });
  const cashIds = new Set(banks.map((bank) => bank.ledgerAccountId).filter((id): id is string => Boolean(id)));
  const entries = await prisma.journalEntry.findMany({
    where: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      status: { in: ['POSTED', 'REVERSED'] },
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
              ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    },
    include: { lines: { include: { account: true } } },
    orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
  });
  return entries.flatMap((entry) =>
    entry.lines.map((line) => ({
      entryId: entry.id,
      date: dateOnly(entry.date),
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: line.account.type,
      normalBalance: line.account.normalBalance,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      cashAccount:
        line.account.code === mappings.cash || line.account.code === mappings.bank || cashIds.has(line.accountId),
    })),
  );
}

export async function buildReport(actor: CompanyActor, type: string, from?: string, to?: string) {
  const lines = await postedLines(actor, from, to);
  const company = await prisma.clientCompany.findFirst({ where: { id: actor.companyId, firmId: actor.firmId } });
  const base = { company: company?.legalName, from, to, generatedAt: new Date().toISOString() };
  if (type === 'trial-balance') return { ...base, ...trialBalance(lines) };
  if (type === 'income-statement') return { ...base, ...incomeStatement(lines) };
  if (type === 'balance-sheet') return { ...base, ...balanceSheet(lines) };
  if (type === 'cash-flow') return { ...base, ...cashFlowStatement(lines) };
  if (type === 'ledger') return { ...base, accounts: generalLedger(lines) };
  if (type === 'receivables') return { ...base, rows: await openInvoices(actor) };
  if (type === 'payables') return { ...base, rows: await openPurchases(actor) };
  if (type === 'vat') return { ...base, ...(await vatSummary(actor, from, to)) };
  throw new Error('Lloji i raportit nuk njihet.');
}

export async function vatSummary(actor: CompanyActor, from?: string, to?: string) {
  const date = {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
  };
  const hasDate = Boolean(from || to);
  const [invoices, purchases] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        firmId: actor.firmId,
        companyId: actor.companyId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        ...(hasDate ? { issueDate: date } : {}),
      },
      include: { lines: true, customer: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        firmId: actor.firmId,
        companyId: actor.companyId,
        status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
        ...(hasDate ? { issueDate: date } : {}),
      },
      include: { lines: true, supplier: true },
    }),
  ]);
  const sales = invoices.flatMap((invoice) =>
    invoice.lines.map((line) => ({
      treatment: line.taxTreatment,
      net: line.netAmount.toString(),
      vat: line.vatAmount.toString(),
    })),
  );
  const purchaseRows = purchases.flatMap((purchase) =>
    purchase.lines.map((line) => ({
      treatment: line.taxTreatment,
      net: line.netAmount.toString(),
      vat: line.vatAmount.toString(),
      deductible: line.deductible,
    })),
  );
  return {
    ...summarizeVat(sales, purchaseRows),
    salesRegister: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.displayNumber,
      date: dateOnly(invoice.issueDate),
      customer: invoice.customer?.name,
      net: invoice.taxableBase.toString(),
      vat: invoice.vatTotal.toString(),
      total: invoice.total.toString(),
    })),
    purchaseRegister: purchases.map((purchase) => ({
      id: purchase.id,
      number: purchase.supplierInvoiceNumber,
      date: dateOnly(purchase.issueDate),
      supplier: purchase.supplier?.name,
      net: purchase.subtotal.toString(),
      vat: purchase.vatTotal.toString(),
      total: purchase.total.toString(),
    })),
  };
}

async function openInvoices(actor: CompanyActor) {
  const rows = await prisma.invoice.findMany({
    where: { firmId: actor.firmId, companyId: actor.companyId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    include: { customer: true },
    orderBy: { dueDate: 'asc' },
  });
  return rows.map((invoice) => ({
    id: invoice.id,
    number: invoice.displayNumber,
    customer: invoice.customer?.name,
    dueDate: dateOnly(invoice.dueDate),
    total: invoice.total.toString(),
    outstanding: invoice.total.minus(invoice.amountPaid).minus(invoice.amountCredited).toString(),
    status: invoice.status,
  }));
}

async function openPurchases(actor: CompanyActor) {
  const rows = await prisma.purchaseInvoice.findMany({
    where: { firmId: actor.firmId, companyId: actor.companyId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
    include: { supplier: true },
    orderBy: { dueDate: 'asc' },
  });
  return rows.map((purchase) => ({
    id: purchase.id,
    number: purchase.supplierInvoiceNumber,
    supplier: purchase.supplier?.name,
    dueDate: dateOnly(purchase.dueDate),
    total: purchase.total.toString(),
    outstanding: purchase.total.minus(purchase.amountPaid).toString(),
    status: purchase.status,
  }));
}

export async function workbookFor(actor: CompanyActor, type: string, from?: string, to?: string) {
  const report = await buildReport(actor, type, from, to);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kontabiliteti Pro';
  const sheet = workbook.addWorksheet('Raporti');
  sheet.addRow(['Kontabiliteti Pro']);
  sheet.addRow(['Raport i brendshëm. Nuk është deklaratë e dorëzuar te ATK.']);
  sheet.addRow(['Kompania', report.company ?? '']);
  sheet.addRow(['Periudha', `${from ?? ''} - ${to ?? ''}`]);
  sheet.addRow([]);
  const rows = flattenReport(report);
  if (rows.length > 0) {
    sheet.addRow(Object.keys(rows[0]));
    rows.forEach((row) => sheet.addRow(Object.values(row)));
  }
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'report.export',
    entityType: 'Report',
    summary: `U eksportua raporti ${type}.`,
    sensitive: true,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function csvFor(report: Record<string, unknown>) {
  const rows = flattenReport(report);
  if (rows.length === 0) return 'nuk ka te dhena\n';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

function flattenReport(report: Record<string, unknown>): Record<string, string>[] {
  const preferred = ['rows', 'revenue', 'expenses', 'assets', 'liabilities', 'equity', 'salesRegister', 'purchaseRegister'];
  for (const key of preferred) {
    const value = report[key];
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      return value.map((item) => stringifyRow(item as Record<string, unknown>));
    }
  }
  return [stringifyRow(report)];
}

function stringifyRow(row: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) output[key] = '';
    else if (typeof value === 'object') output[key] = JSON.stringify(value);
    else output[key] = String(value);
  }
  return output;
}
