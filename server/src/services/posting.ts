import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertBalanced, type JournalLineInput } from '../domain/journal';
import { AppError, badRequest } from '../lib/errors';
import { asDate } from '../lib/dates';
import { prisma } from '../lib/prisma';
import { DEFAULT_MAPPINGS } from '../lib/chart';

type Db = Prisma.TransactionClient | PrismaClient;

export async function nextDocumentNumber(
  tx: Db,
  input: { firmId: string; companyId: string; docType: string; series: string; fiscalYear: number },
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "DocumentSequence" ("id", "firmId", "companyId", "docType", "series", "fiscalYear", "lastNumber")
    VALUES (${randomUUID()}::uuid, ${input.firmId}::uuid, ${input.companyId}::uuid, ${input.docType}, ${input.series}, ${input.fiscalYear}, 1)
    ON CONFLICT ("companyId", "docType", "series", "fiscalYear")
    DO UPDATE SET "lastNumber" = "DocumentSequence"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  const value = rows[0]?.lastNumber;
  if (!value) throw new AppError('SEQUENCE_FAILED', 500, 'Numërimi i dokumentit dështoi.');
  return value;
}

export function formatDocumentNumber(series: string, fiscalYear: number, number: number): string {
  return `${series}-${fiscalYear}-${String(number).padStart(5, '0')}`;
}

export async function assertOpenPeriod(tx: Db, companyId: string, isoDate: string) {
  const date = asDate(isoDate);
  const period = await tx.fiscalPeriod.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
  if (!period) {
    throw new AppError('PERIOD_MISSING', 409, 'Nuk ka periudhë fiskale për këtë datë. Krijojeni periudhën para postimit.');
  }
  if (period.status === 'CLOSED') {
    throw new AppError('PERIOD_CLOSED', 409, 'Periudha fiskale është e mbyllur. Postimi refuzohet.');
  }
  return period;
}

export async function postJournal(
  tx: Db,
  input: {
    firmId: string;
    companyId: string;
    date: string;
    description: string;
    sourceType: string;
    sourceId?: string;
    createdById: string;
    lines: JournalLineInput[];
  },
) {
  let balanced: { debit: string; credit: string };
  try {
    balanced = assertBalanced(input.lines);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Regjistrimi nuk është i vlefshëm.');
  }
  const period = await assertOpenPeriod(tx, input.companyId, input.date);
  const fiscalYear = Number(input.date.slice(0, 4));
  const entryNumber = await nextDocumentNumber(tx, {
    firmId: input.firmId,
    companyId: input.companyId,
    docType: 'JOURNAL',
    series: 'REG',
    fiscalYear,
  });
  return tx.journalEntry.create({
    data: {
      firmId: input.firmId,
      companyId: input.companyId,
      entryNumber,
      date: asDate(input.date),
      description: input.description,
      status: 'POSTED',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      periodId: period.id,
      postedAt: new Date(),
      postedById: input.createdById,
      createdById: input.createdById,
      lines: {
        create: input.lines.map((line) => ({
          firmId: input.firmId,
          companyId: input.companyId,
          accountId: line.accountId,
          description: line.description,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
        })),
      },
    },
    include: { lines: true },
  }).then((entry) => ({ entry, balanced }));
}

export async function mappingsFor(tx: Db, companyId: string) {
  const settings = await tx.companySettings.findUnique({ where: { companyId } });
  if (!settings) throw badRequest('Cilësimet e kompanisë mungojnë.');
  const stored = (settings.mappings ?? {}) as Record<string, string>;
  return { settings, mappings: { ...DEFAULT_MAPPINGS, ...stored } };
}

export async function accountIdByCode(tx: Db, companyId: string, code: string) {
  const account = await tx.account.findUnique({ where: { companyId_code: { companyId, code } } });
  if (!account || !account.isActive) {
    throw new AppError(
      'ACCOUNT_MISSING',
      409,
      `Llogaria ${code} mungon ose është joaktive. Hartimi kontabël është i konfigurueshëm dhe duhet plotësuar para postimit.`,
    );
  }
  return account.id;
}

export async function assertWritableSubscription(firmId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { firmId }, include: { plan: true } });
  if (!subscription) throw new AppError('SUBSCRIPTION_REQUIRED', 403, 'Zyra nuk ka abonim.');
  const blocked = subscription.readOnly || ['EXPIRED', 'SUSPENDED', 'CANCELLED'].includes(subscription.status);
  if (blocked) {
    throw new AppError(
      'SUBSCRIPTION_READONLY',
      403,
      'Abonimi është në gjendje vetëm për lexim. Regjistrimet financiare nuk fshihen, por ndryshimet e reja janë të ndaluara.',
    );
  }
  return subscription;
}

export async function assertFeature(firmId: string, featureKey: string) {
  const subscription = await assertWritableSubscription(firmId);
  const full = await prisma.subscription.findUnique({
    where: { firmId },
    include: { plan: { include: { entitlements: true } } },
  });
  const enabled = full?.plan.entitlements.some((item) => item.featureKey === featureKey && item.enabled);
  if (!enabled) {
    throw new AppError('FEATURE_DISABLED', 403, 'Kjo veçori nuk përfshihet në planin aktual.');
  }
  return subscription;
}

export async function assertCompanyLimit(firmId: string) {
  const subscription = await assertWritableSubscription(firmId);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: subscription.planId } });
  if (plan?.maxCompanies != null) {
    const count = await prisma.clientCompany.count({ where: { firmId, status: { not: 'ARCHIVED' } } });
    if (count >= plan.maxCompanies) {
      throw new AppError('LIMIT_REACHED', 403, 'Është arritur kufiri i kompanive kliente për planin aktual.');
    }
  }
}

export async function assertMemberLimit(firmId: string) {
  const subscription = await assertWritableSubscription(firmId);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: subscription.planId } });
  if (plan?.maxMembers != null) {
    const count = await prisma.firmMembership.count({ where: { firmId, status: { not: 'DEACTIVATED' } } });
    if (count >= plan.maxMembers) {
      throw new AppError('LIMIT_REACHED', 403, 'Është arritur kufiri i anëtarëve për planin aktual.');
    }
  }
}

export async function exchangeRateFor(tx: Db, companyId: string, currency: string, isoDate: string) {
  if (currency === 'EUR') return '1.00000000';
  const rate = await tx.exchangeRate.findFirst({
    where: { companyId, quoteCurrency: currency, baseCurrency: 'EUR', effectiveOn: { lte: asDate(isoDate) } },
    orderBy: { effectiveOn: 'desc' },
  });
  if (!rate) {
    throw new AppError(
      'EXCHANGE_RATE_MISSING',
      409,
      'Mungon kursi i këmbimit për këtë monedhë dhe datë. Kursi duhet regjistruar manualisht; programi nuk e shpik atë.',
    );
  }
  return rate.rate.toString();
}
