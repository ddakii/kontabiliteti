import { Prisma } from '@prisma/client';
import { AGING_LABELS, agingBucket, type AgingBucket } from '../domain/aging';
import { writeAudit } from '../lib/audit';
import { addDays, asDate, dateOnly, todayISO } from '../lib/dates';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import type { CompanyActor, FirmActor } from '../types/express';
import { createPayment } from './payments';

const MONTH_ITEMS = [
  ['sales', 'Mblidhni faturat e shitjes'],
  ['purchases', 'Mblidhni faturat e blerjes'],
  ['expenses', 'Mblidhni dokumentet e shpenzimeve'],
  ['bank-import', 'Importoni ekstraktin bankar'],
  ['bank-review', 'Shqyrtoni transaksionet bankare'],
  ['payments', 'Përputhni pagesat'],
  ['customers', 'Shqyrtoni saldot e blerësve'],
  ['suppliers', 'Shqyrtoni saldot e furnitorëve'],
  ['vat', 'Shqyrtoni regjistrimet e TVSH-së'],
  ['payroll', 'Shqyrtoni pagat, nëse moduli është i aktivizuar'],
  ['documents', 'Shqyrtoni dokumentet e papërfunduara'],
  ['reports', 'Gjeneroni raportet paraprake'],
  ['differences', 'Zgjidhni mospërputhjet'],
  ['close-review', 'Shqyrtoni nëse periudha është gati për mbyllje'],
] as const;

async function visibleCompanies(actor: FirmActor) {
  const assigned = actor.accessScope === 'ALL_COMPANIES'
    ? undefined
    : (await prisma.companyAssignment.findMany({ where: { firmId: actor.firmId, userId: actor.userId }, select: { companyId: true } })).map((row) => row.companyId);
  return prisma.clientCompany.findMany({
    where: { firmId: actor.firmId, ...(assigned ? { id: { in: assigned } } : {}) },
    select: { id: true, legalName: true, status: true, municipality: true, vatStatus: true, servicePackage: true },
    orderBy: { legalName: 'asc' },
  });
}

export async function workQueue(actor: FirmActor) {
  const companies = await visibleCompanies(actor);
  const ids = companies.map((company) => company.id);
  const names = new Map(companies.map((company) => [company.id, company.legalName]));
  if (ids.length === 0) return [];
  const today = todayISO();
  const [requests, purchases, banks, taxes, periods, tasks, drafts] = await Promise.all([
    prisma.documentRequest.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'OPEN' }, take: 20 }),
    prisma.purchaseInvoice.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: { in: ['DRAFT', 'IN_REVIEW'] } }, take: 20 }),
    prisma.bankTransaction.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, matchStatus: 'UNMATCHED' }, take: 20 }),
    prisma.taxReport.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'INTERNAL_DRAFT' }, take: 20 }),
    prisma.fiscalPeriod.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'OPEN', endDate: { lt: asDate(today), gte: asDate(addDays(today, -45)) } }, take: 12 }),
    prisma.task.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: { not: 'COMPLETED' }, dueDate: { lte: asDate(today) } }, take: 20 }),
    prisma.invoice.findMany({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'DRAFT' }, take: 20 }),
  ]);
  const items = [
    ...requests.map((row) => item('documents', row.id, row.companyId, names, 'Mungon një dokument i kërkuar', row.message, '/dokumentet', 'warning')),
    ...purchases.map((row) => item(
      'purchase',
      row.id,
      row.companyId,
      names,
      row.status === 'DRAFT' ? 'Blerja pret shqyrtim' : 'Blerja është në shqyrtim',
      row.supplierInvoiceNumber ?? 'Pa numër',
      `/blerjet/${row.id}`,
      'warning',
      row.status === 'DRAFT' ? 'Shqyrto' : 'Posto',
    )),
    ...banks.map((row) => item('bank', row.id, row.companyId, names, 'Transaksion bankar i papërputhur', row.description, '/bankat', 'info')),
    ...taxes.map((row) => item('tax', row.id, row.companyId, names, 'Përgatitja e TVSH-së pret shqyrtim', dateOnly(row.periodStart), '/tvsh', 'warning')),
    ...periods.map((row) => item('period', row.id, row.companyId, names, 'Periudha është e hapur pas datës së mbarimit', row.name, '/muaji', 'warning')),
    ...tasks.map((row) => item('task', row.id, row.companyId ?? '', names, row.dueDate && dateOnly(row.dueDate) < today ? 'Detyrë me vonesë' : 'Detyrë për sot', row.title, '/detyrat', 'warning')),
    ...drafts.map((row) => item('invoice', row.id, row.companyId, names, 'Faturë draft', row.displayNumber ?? 'Pa numër', '/faturat', 'info')),
  ];
  return items;
}

function item(kind: string, id: string, companyId: string, names: Map<string, string>, title: string, detail: string, href: string, severity: 'info' | 'warning', action?: string) {
  return { id: `${kind}:${id}`, kind, companyId, companyName: names.get(companyId) ?? '', title, detail, href, severity, action: action ?? 'Hap' };
}

export async function companyDirectory(actor: FirmActor) {
  const companies = await visibleCompanies(actor);
  const ids = companies.map((company) => company.id);
  if (ids.length === 0) return [];
  const [tasks, requests, audits] = await Promise.all([
    prisma.task.groupBy({ by: ['companyId'], where: { firmId: actor.firmId, companyId: { in: ids }, status: { not: 'COMPLETED' } }, _count: { _all: true } }),
    prisma.documentRequest.groupBy({ by: ['companyId'], where: { firmId: actor.firmId, companyId: { in: ids }, status: 'OPEN' }, _count: { _all: true } }),
    prisma.auditLog.findMany({ where: { firmId: actor.firmId, companyId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 300, select: { companyId: true, createdAt: true, summary: true } }),
  ]);
  const taskCount = new Map(tasks.map((row) => [row.companyId, row._count._all]));
  const requestCount = new Map(requests.map((row) => [row.companyId, row._count._all]));
  const latest = new Map<string, { createdAt: Date; summary: string }>();
  for (const audit of audits) {
    if (audit.companyId && !latest.has(audit.companyId)) latest.set(audit.companyId, { createdAt: audit.createdAt, summary: audit.summary });
  }
  return companies.map((company) => ({
    ...company,
    openTasks: taskCount.get(company.id) ?? 0,
    openDocumentRequests: requestCount.get(company.id) ?? 0,
    lastActivityAt: latest.get(company.id)?.createdAt ?? null,
    lastActivity: latest.get(company.id)?.summary ?? null,
  }));
}

export async function companyReadiness(actor: FirmActor, companyId: string) {
  const company = await prisma.clientCompany.findFirst({ where: { id: companyId, firmId: actor.firmId } });
  if (!company) throw notFound('Kompania nuk u gjet.');
  const [requirements, requests, purchases, banks, tasks, drafts] = await Promise.all([
    prisma.onboardingDocumentRequirement.count({ where: { companyId, isRequired: true, fulfilledAt: null } }),
    prisma.documentRequest.count({ where: { firmId: actor.firmId, companyId, status: 'OPEN' } }),
    prisma.purchaseInvoice.count({ where: { firmId: actor.firmId, companyId, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
    prisma.bankTransaction.count({ where: { firmId: actor.firmId, companyId, matchStatus: 'UNMATCHED' } }),
    prisma.task.count({ where: { firmId: actor.firmId, companyId, status: { not: 'COMPLETED' } } }),
    prisma.invoice.count({ where: { firmId: actor.firmId, companyId, status: 'DRAFT' } }),
  ]);
  const factors = [
    { key: 'documents', label: 'Dokumente të kërkuara të paplota', count: requirements + requests, penalty: (requirements + requests) * 8 },
    { key: 'purchases', label: 'Blerje të pashqyrtuara', count: purchases, penalty: purchases * 6 },
    { key: 'bank', label: 'Transaksione bankare të papërputhura', count: banks, penalty: banks * 4 },
    { key: 'tasks', label: 'Detyra të hapura', count: tasks, penalty: tasks * 5 },
    { key: 'drafts', label: 'Fatura draft', count: drafts, penalty: drafts * 3 },
  ];
  const score = Math.max(0, 100 - factors.reduce((sum, factor) => sum + factor.penalty, 0));
  const label = score >= 85 ? 'Gati për shqyrtim' : score >= 60 ? 'Në proces' : 'Kërkon vëmendje';
  return {
    score,
    label,
    disclaimer: 'Ky është tregues operacional i gatishmërisë. Nuk është vlerësim ligjor dhe nuk garanton pajtueshmëri tatimore.',
    factors: factors.filter((factor) => factor.count > 0),
  };
}

export async function ensureMonthChecklist(actor: CompanyActor, year: number, month: number) {
  if (month < 1 || month > 12) throw badRequest('Muaji nuk është i vlefshëm.');
  const existing = await prisma.monthChecklist.findFirst({
    where: { firmId: actor.firmId, companyId: actor.companyId, periodYear: year, periodMonth: month },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (existing) return existing;
  return prisma.monthChecklist.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      periodYear: year,
      periodMonth: month,
      items: {
        create: MONTH_ITEMS.map(([code, title], position) => ({
          firmId: actor.firmId,
          companyId: actor.companyId,
          code,
          title,
          position,
          status: code === 'payroll' ? 'NOT_APPLICABLE' : 'OPEN',
        })),
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
}

export async function updateMonthItem(
  actor: CompanyActor,
  itemId: string,
  input: { status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'NOT_APPLICABLE'; comment?: string },
) {
  const item = await prisma.monthChecklistItem.findFirst({ where: { id: itemId, firmId: actor.firmId, companyId: actor.companyId } });
  if (!item) throw notFound('Pika e listës nuk u gjet.');
  const status = input.status ?? item.status;
  const updated = await prisma.monthChecklistItem.update({
    where: { id: item.id },
    data: {
      status,
      comment: input.comment,
      completedAt: status === 'DONE' ? new Date() : null,
      completedById: status === 'DONE' ? actor.userId : null,
    },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'month.item_updated',
    entityType: 'MonthChecklistItem',
    entityId: item.id,
    summary: `U përditësua pika operative «${item.title}». Kjo nuk është dorëzim tatimor.`,
  });
  return updated;
}

export async function agingReport(actor: CompanyActor, asOf = todayISO()) {
  const invoices = await prisma.invoice.findMany({
    where: { firmId: actor.firmId, companyId: actor.companyId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    include: { customer: true },
  });
  const buckets: Record<AgingBucket, { count: number; amount: Prisma.Decimal }> = {
    NOT_DUE: { count: 0, amount: new Prisma.Decimal(0) },
    DAYS_1_30: { count: 0, amount: new Prisma.Decimal(0) },
    DAYS_31_60: { count: 0, amount: new Prisma.Decimal(0) },
    DAYS_61_90: { count: 0, amount: new Prisma.Decimal(0) },
    DAYS_90_PLUS: { count: 0, amount: new Prisma.Decimal(0) },
  };
  const rows = [];
  for (const invoice of invoices) {
    const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid).minus(invoice.amountCredited);
    if (outstanding.lte(0)) continue;
    const bucket = agingBucket(dateOnly(invoice.dueDate), asOf);
    buckets[bucket].count += 1;
    buckets[bucket].amount = buckets[bucket].amount.plus(outstanding);
    rows.push({
      id: invoice.id,
      displayNumber: invoice.displayNumber,
      customer: invoice.customer?.name ?? '—',
      dueDate: dateOnly(invoice.dueDate),
      outstanding: outstanding.toFixed(2),
      bucket,
      bucketLabel: AGING_LABELS[bucket],
    });
  }
  return {
    asOf,
    companyId: actor.companyId,
    generatedAt: new Date().toISOString(),
    note: 'Intervalet llogariten nga data e afatit deri te data e raportit. Nuk përfshijnë fatura draft.',
    buckets: Object.entries(buckets).map(([key, value]) => ({ key, label: AGING_LABELS[key as AgingBucket], count: value.count, amount: value.amount.toFixed(2) })),
    rows,
  };
}

export async function bankWorkspace(actor: CompanyActor) {
  const [accounts, transactions] = await Promise.all([
    prisma.bankAccount.findMany({ where: { firmId: actor.firmId, companyId: actor.companyId, isActive: true } }),
    prisma.bankTransaction.findMany({ where: { firmId: actor.firmId, companyId: actor.companyId }, orderBy: { bookedOn: 'desc' }, take: 100 }),
  ]);
  const invoices = await prisma.invoice.findMany({
    where: { firmId: actor.firmId, companyId: actor.companyId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
  });
  const suggestions = [];
  for (const transaction of transactions.filter((row) => row.matchStatus === 'UNMATCHED' && new Prisma.Decimal(row.amount).gt(0))) {
    const match = invoices.find((invoice) => {
      const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid).minus(invoice.amountCredited);
      return outstanding.equals(transaction.amount);
    });
    if (match) {
      suggestions.push({
        transactionId: transaction.id,
        description: transaction.description,
        amount: transaction.amount.toString(),
        invoiceId: match.id,
        displayNumber: match.displayNumber,
        reason: 'Shuma e transaksionit përputhet me saldon e papaguar të faturës. Nuk postohet pa konfirmim.',
      });
    }
  }
  return { accounts, transactions, suggestions, connected: false, note: 'Nuk ka lidhje të drejtpërdrejtë me bankën. Importi është nga skedar.' };
}

export async function confirmBankMatch(actor: CompanyActor, transactionId: string, invoiceId: string) {
  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, firmId: actor.firmId, companyId: actor.companyId, matchStatus: 'UNMATCHED' },
  });
  if (!transaction) throw notFound('Transaksioni nuk u gjet ose është përputhur tashmë.');
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, firmId: actor.firmId, companyId: actor.companyId } });
  if (!invoice) throw notFound('Fatura nuk u gjet.');
  const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid).minus(invoice.amountCredited);
  if (new Prisma.Decimal(transaction.amount).gt(outstanding)) throw badRequest('Shuma e transaksionit e kalon saldon e faturës.');
  const payment = await createPayment(actor, {
    direction: 'INCOMING',
    amount: transaction.amount.toString(),
    date: dateOnly(transaction.bookedOn),
    method: 'BANK',
    bankAccountId: transaction.bankAccountId,
    customerId: invoice.customerId ?? undefined,
    reference: transaction.reference ?? transaction.description,
    allocations: [{ invoiceId: invoice.id, amount: transaction.amount.toString() }],
  });
  if (!payment) throw badRequest('Pagesa nuk u krijua.');
  await prisma.bankTransaction.update({
    where: { id: transaction.id },
    data: { matchStatus: 'MATCHED', paymentId: payment.id },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'bank.matched',
    entityType: 'BankTransaction',
    entityId: transaction.id,
    summary: `U konfirmua përputhja e transaksionit me faturën ${invoice.displayNumber ?? invoice.id}.`,
    sensitive: true,
  });
  return { paymentId: payment.id, transactionId: transaction.id };
}

export async function documentInbox(actor: FirmActor) {
  const companies = await visibleCompanies(actor);
  const ids = companies.map((company) => company.id);
  const documents = await prisma.document.findMany({
    where: { firmId: actor.firmId, companyId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const names = new Map(companies.map((company) => [company.id, company.legalName]));
  return documents.map((document) => ({ ...document, companyName: names.get(document.companyId) ?? '' }));
}

export async function firmAudit(actor: FirmActor) {
  return prisma.auditLog.findMany({
    where: { firmId: actor.firmId },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: { id: true, action: true, summary: true, createdAt: true, companyId: true, entityType: true, entityId: true },
  });
}
