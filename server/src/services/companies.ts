import { Prisma } from '@prisma/client';
import { assertBalanced } from '../domain/journal';
import { writeAudit } from '../lib/audit';
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_MAPPINGS,
  TAX_TEMPLATES,
} from '../lib/chart';
import { asDate, dateOnly, fiscalYearContaining, monthBounds } from '../lib/dates';
import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { assertCompanyLimit, postJournal } from './posting';
import type { FirmActor } from '../types/express';

export async function listCompanies(actor: FirmActor, query: { q?: string; status?: string; page: number; pageSize: number }) {
  const assigned =
    actor.accessScope === 'ALL_COMPANIES'
      ? undefined
      : (
          await prisma.companyAssignment.findMany({
            where: { firmId: actor.firmId, userId: actor.userId },
            select: { companyId: true },
          })
        ).map((row) => row.companyId);
  const where = {
    firmId: actor.firmId,
    ...(assigned ? { id: { in: assigned } } : {}),
    ...(query.status ? { status: query.status as 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'ARCHIVED' } : {}),
    ...(query.q
      ? {
          OR: [
            { legalName: { contains: query.q, mode: 'insensitive' as const } },
            { tradeName: { contains: query.q, mode: 'insensitive' as const } },
            { fiscalNumber: { contains: query.q, mode: 'insensitive' as const } },
            { businessNumber: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.clientCompany.count({ where }),
    prisma.clientCompany.findMany({
      where,
      include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
      orderBy: { legalName: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, rows };
}

export async function createCompany(
  actor: FirmActor,
  input: {
    legalName: string;
    tradeName?: string;
    businessNumber?: string;
    fiscalNumber?: string;
    vatNumber?: string;
    address?: string;
    municipality?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    activity?: string;
    vatStatus?: 'REGISTERED' | 'NOT_REGISTERED' | 'EXEMPT' | 'UNKNOWN';
    accountingStartDate: string;
    fiscalYearStartMonth?: number;
    servicePackage?: string;
    assignedUserId?: string;
    notes?: string;
  },
  ip?: string,
  correlationId?: string,
) {
  await assertCompanyLimit(actor.firmId);
  const startMonth = input.fiscalYearStartMonth ?? 1;
  if (startMonth < 1 || startMonth > 12) throw badRequest('Muaji i fillimit të vitit fiskal nuk është i vlefshëm.');

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.clientCompany.create({
      data: {
        firmId: actor.firmId,
        legalName: input.legalName.trim(),
        tradeName: input.tradeName?.trim(),
        businessNumber: input.businessNumber?.trim(),
        fiscalNumber: input.fiscalNumber?.trim(),
        vatNumber: input.vatNumber?.trim(),
        address: input.address?.trim(),
        municipality: input.municipality,
        contactName: input.contactName?.trim(),
        email: input.email?.trim().toLowerCase(),
        phone: input.phone?.trim(),
        activity: input.activity?.trim(),
        vatStatus: input.vatStatus ?? 'UNKNOWN',
        accountingStartDate: asDate(input.accountingStartDate),
        fiscalYearStartMonth: startMonth,
        status: 'ACTIVE',
        servicePackage: input.servicePackage?.trim(),
        engagementStatus: 'ACTIVE',
        notes: input.notes,
        onboardingStep: 2,
      },
    });
    await tx.companySettings.create({
      data: {
        companyId: created.id,
        firmId: actor.firmId,
        mappings: DEFAULT_MAPPINGS,
        allowUnconfirmedTaxRates: false,
      },
    });
    await tx.account.createMany({
      data: DEFAULT_ACCOUNTS.map((account) => ({
        firmId: actor.firmId,
        companyId: created.id,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        description: account.description,
        isSystem: true,
      })),
    });
    await tx.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ firmId: actor.firmId, companyId: created.id, name })),
    });
    await tx.taxRate.createMany({
      data: TAX_TEMPLATES.map((template) => ({
        firmId: actor.firmId,
        companyId: created.id,
        code: template.code,
        name: template.name,
        ratePercent: new Prisma.Decimal(template.ratePercent),
        treatment: template.treatment,
        effectiveFrom: asDate(template.effectiveFrom),
        sourceNote: template.sourceNote,
        isTemplate: false,
        isActive: true,
      })),
    });
    const fiscal = fiscalYearContaining(input.accountingStartDate, startMonth);
    const periods = monthlyPeriods(fiscal.start);
    await tx.fiscalPeriod.createMany({
      data: periods.map((period) => ({
        firmId: actor.firmId,
        companyId: created.id,
        name: period.name,
        startDate: asDate(period.start),
        endDate: asDate(period.end),
      })),
    });
    await tx.accountingEngagement.create({
      data: {
        firmId: actor.firmId,
        companyId: created.id,
        servicePackage: input.servicePackage?.trim() || 'Pa paketë',
        status: 'DRAFT',
        startDate: asDate(input.accountingStartDate),
      },
    });
    await tx.onboardingDocumentRequirement.createMany({
      data: ['Certifikata e biznesit', 'Certifikata e numrit fiskal', 'Kontrata e angazhimit', 'Bilanci hapës'].map((name) => ({
        companyId: created.id,
        name,
      })),
    });
    await tx.bankAccount.create({
      data: {
        firmId: actor.firmId,
        companyId: created.id,
        name: 'Arka',
        isCash: true,
        currency: 'EUR',
        connected: false,
      },
    });
    if (input.assignedUserId) {
      await assignInTransaction(tx, actor, created.id, input.assignedUserId);
    }
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId: created.id,
        userId: actor.userId,
        action: 'company.created',
        entityType: 'ClientCompany',
        entityId: created.id,
        summary: `U krijua kompania ${created.legalName}.`,
        ip,
        correlationId,
        sensitive: true,
      },
      tx,
    );
    return created;
  });
  return company;
}

export async function getCompany(actor: FirmActor, companyId: string) {
  const company = await prisma.clientCompany.findFirst({
    where: { id: companyId, firmId: actor.firmId },
    include: {
      settings: true,
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
      requirements: true,
      engagements: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });
  if (!company) throw notFound('Kompania nuk u gjet.');
  if (actor.accessScope !== 'ALL_COMPANIES') {
    const allowed = company.assignments.some((assignment) => assignment.userId === actor.userId);
    if (!allowed) throw notFound('Kompania nuk u gjet.');
  }
  return company;
}

export async function updateCompany(actor: FirmActor, companyId: string, input: Record<string, unknown>, ip?: string) {
  await getCompany(actor, companyId);
  const data: Prisma.ClientCompanyUpdateInput = {};
  const textFields = [
    'legalName',
    'tradeName',
    'businessNumber',
    'fiscalNumber',
    'vatNumber',
    'address',
    'municipality',
    'contactName',
    'email',
    'phone',
    'activity',
    'servicePackage',
    'notes',
  ] as const;
  for (const field of textFields) {
    if (typeof input[field] === 'string') data[field] = (input[field] as string).trim();
  }
  if (typeof input.vatStatus === 'string') data.vatStatus = input.vatStatus as 'REGISTERED';
  if (typeof input.status === 'string') data.status = input.status as 'ACTIVE';
  if (typeof input.onboardingStep === 'number') data.onboardingStep = input.onboardingStep;
  if (input.onboardingCompleted === true) {
    data.onboardingCompletedAt = new Date();
    data.status = 'ACTIVE';
    data.engagementStatus = 'ACTIVE';
  }
  const company = await prisma.clientCompany.update({ where: { id: companyId }, data });
  if (typeof input.servicePackage === 'string' || input.onboardingCompleted === true) {
    await prisma.accountingEngagement.create({
      data: {
        firmId: actor.firmId,
        companyId,
        servicePackage: company.servicePackage || 'Pa paketë',
        status: company.engagementStatus,
        startDate: company.accountingStartDate,
      },
    });
  }
  await writeAudit({
    firmId: actor.firmId,
    companyId,
    userId: actor.userId,
    action: 'company.updated',
    entityType: 'ClientCompany',
    entityId: companyId,
    summary: `U përditësua kompania ${company.legalName}.`,
    ip,
    sensitive: true,
  });
  return company;
}

export async function archiveCompany(actor: FirmActor, companyId: string, ip?: string) {
  await getCompany(actor, companyId);
  const company = await prisma.clientCompany.update({
    where: { id: companyId },
    data: { status: 'ARCHIVED', engagementStatus: 'ENDED' },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId,
    userId: actor.userId,
    action: 'company.archived',
    entityType: 'ClientCompany',
    entityId: companyId,
    summary: `U arkivua kompania ${company.legalName}. Regjistrimet financiare mbeten.`,
    ip,
    sensitive: true,
  });
  return company;
}

export async function assignAccountant(actor: FirmActor, companyId: string, userId: string) {
  await getCompany(actor, companyId);
  await prisma.$transaction((tx) => assignInTransaction(tx, actor, companyId, userId));
  await writeAudit({
    firmId: actor.firmId,
    companyId,
    userId: actor.userId,
    action: 'company.assigned',
    entityType: 'ClientCompany',
    entityId: companyId,
    summary: 'U caktua një kontabilist te kompania.',
    sensitive: true,
  });
}

async function assignInTransaction(
  tx: Prisma.TransactionClient,
  actor: FirmActor,
  companyId: string,
  userId: string,
) {
  const membership = await tx.firmMembership.findFirst({ where: { firmId: actor.firmId, userId, status: 'ACTIVE' } });
  if (!membership) throw badRequest('Përdoruesi nuk është anëtar aktiv i zyrës.');
  await tx.companyAssignment.upsert({
    where: { membershipId_companyId: { membershipId: membership.id, companyId } },
    update: {},
    create: { membershipId: membership.id, companyId, userId, firmId: actor.firmId },
  });
}

export async function postOpeningBalances(
  actor: FirmActor,
  companyId: string,
  input: { date: string; lines: { accountCode: string; debit: string; credit: string }[] },
) {
  const company = await getCompany(actor, companyId);
  const existing = await prisma.journalEntry.findFirst({
    where: { companyId, firmId: actor.firmId, sourceType: 'OPENING_BALANCE', status: 'POSTED' },
  });
  if (existing) throw badRequest('Bilanci hapës është postuar tashmë. Korrigjimi bëhet me regjistrim të ri, jo duke e fshirë.');
  const accounts = await prisma.account.findMany({ where: { companyId, firmId: actor.firmId } });
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const lines = input.lines.map((line) => {
    const account = byCode.get(line.accountCode);
    if (!account) throw badRequest(`Llogaria ${line.accountCode} nuk ekziston.`);
    return { accountId: account.id, debit: line.debit, credit: line.credit, description: 'Bilanci hapës' };
  });
  try {
    assertBalanced(lines);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Bilanci hapës nuk është i vlefshëm.');
  }
  const entry = await prisma.$transaction(async (tx) => {
    const posted = await postJournal(tx, {
      firmId: actor.firmId,
      companyId,
      date: input.date,
      description: `Bilanci hapës — ${company.legalName}`,
      sourceType: 'OPENING_BALANCE',
      sourceId: companyId,
      createdById: actor.userId,
      lines,
    });
    await writeAudit(
      {
        firmId: actor.firmId,
        companyId,
        userId: actor.userId,
        action: 'journal.posted',
        entityType: 'JournalEntry',
        entityId: posted.entry.id,
        summary: 'U postua bilanci hapës.',
        sensitive: true,
      },
      tx,
    );
    return posted.entry;
  });
  return entry;
}

export async function companyHealth(actor: FirmActor, companyId: string) {
  await getCompany(actor, companyId);
  const [openTasks, missingDocs, overdueInvoices, draftInvoices, unreviewedPurchases, openRequests] = await Promise.all([
    prisma.task.count({ where: { firmId: actor.firmId, companyId, status: { not: 'COMPLETED' } } }),
    prisma.onboardingDocumentRequirement.count({ where: { companyId, isRequired: true, fulfilledAt: null } }),
    prisma.invoice.count({ where: { firmId: actor.firmId, companyId, status: 'OVERDUE' } }),
    prisma.invoice.count({ where: { firmId: actor.firmId, companyId, status: 'DRAFT' } }),
    prisma.purchaseInvoice.count({ where: { firmId: actor.firmId, companyId, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
    prisma.documentRequest.count({ where: { firmId: actor.firmId, companyId, status: 'OPEN' } }),
  ]);
  const timeline = await prisma.auditLog.findMany({
    where: { firmId: actor.firmId, companyId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, action: true, summary: true, createdAt: true, userId: true },
  });
  return { openTasks, missingDocs, overdueInvoices, draftInvoices, unreviewedPurchases, openRequests, timeline };
}

function monthlyPeriods(fiscalStart: string) {
  const start = asDate(fiscalStart);
  const periods: { name: string; start: string; end: string }[] = [];
  for (let index = 0; index < 12; index += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const bounds = monthBounds(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
    periods.push({
      name: `${String(cursor.getUTCMonth() + 1).padStart(2, '0')}.${cursor.getUTCFullYear()}`,
      start: bounds.start,
      end: bounds.end,
    });
  }
  return periods;
}

void dateOnly;
