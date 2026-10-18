import { Prisma } from '@prisma/client';
import { writeAudit } from '../lib/audit';
import { AppError, badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { FEATURES } from '../lib/access';

export async function platformMetrics() {
  const [firms, activeFirms, companies, subscriptions, trials, failedJobs, openSupport] = await Promise.all([
    prisma.accountingFirm.count(),
    prisma.accountingFirm.count({ where: { status: 'ACTIVE' } }),
    prisma.clientCompany.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.subscription.count({ where: { status: 'TRIAL' } }),
    prisma.backgroundJob.count({ where: { status: 'FAILED' } }),
    prisma.supportRequest.count({ where: { status: { not: 'CLOSED' } } }),
  ]);
  return { firms, activeFirms, companies, activeSubscriptions: subscriptions, trials, failedJobs, openSupport };
}

export async function listFirms() {
  return prisma.accountingFirm.findMany({
    include: { subscription: { include: { plan: true } }, _count: { select: { companies: true, memberships: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function setFirmStatus(firmId: string, status: 'ACTIVE' | 'SUSPENDED', adminId: string) {
  const firm = await prisma.accountingFirm.update({ where: { id: firmId }, data: { status } });
  await prisma.subscription.updateMany({
    where: { firmId },
    data: { status: status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', readOnly: status === 'SUSPENDED' },
  });
  await writeAudit({ firmId, userId: adminId, action: status === 'SUSPENDED' ? 'platform.suspend' : 'platform.reactivate', summary: status === 'SUSPENDED' ? 'Zyra u pezullua.' : 'Zyra u riaktivizua.' });
  return firm;
}

export async function updatePlan(id: string, input: { name?: string; description?: string; monthlyPrice?: string | null; annualPrice?: string | null; maxCompanies?: number | null; maxMembers?: number | null; isActive?: boolean; entitlements?: { featureKey: string; enabled: boolean }[] }) {
  const plan = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice === undefined ? undefined : input.monthlyPrice === null ? null : new Prisma.Decimal(input.monthlyPrice),
      annualPrice: input.annualPrice === undefined ? undefined : input.annualPrice === null ? null : new Prisma.Decimal(input.annualPrice),
      maxCompanies: input.maxCompanies,
      maxMembers: input.maxMembers,
      isActive: input.isActive,
    },
  });
  if (input.entitlements) {
    for (const entitlement of input.entitlements) {
      if (!FEATURES.includes(entitlement.featureKey as (typeof FEATURES)[number])) continue;
      await prisma.planEntitlement.upsert({
        where: { planId_featureKey: { planId: id, featureKey: entitlement.featureKey } },
        update: { enabled: entitlement.enabled },
        create: { planId: id, featureKey: entitlement.featureKey, enabled: entitlement.enabled },
      });
    }
  }
  return prisma.subscriptionPlan.findUnique({ where: { id: plan.id }, include: { entitlements: true } });
}

export async function activateSubscription(adminId: string, firmId: string, input: { planCode: string; interval: 'MONTHLY' | 'ANNUAL'; periodEnd: string; note: string }) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { code: input.planCode } });
  if (!plan) throw notFound('Plani nuk u gjet.');
  const price = input.interval === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
  const subscription = await prisma.subscription.upsert({
    where: { firmId },
    update: {
      planId: plan.id,
      status: 'ACTIVE',
      interval: input.interval,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
      readOnly: false,
      cancelAtPeriodEnd: false,
    },
    create: {
      firmId,
      planId: plan.id,
      status: 'ACTIVE',
      interval: input.interval,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
    },
  });
  const count = await prisma.billingInvoice.count({ where: { firmId } });
  const invoice = await prisma.billingInvoice.create({
    data: {
      firmId,
      subscriptionId: subscription.id,
      number: `SUB-${String(count + 1).padStart(5, '0')}`,
      amount: price ?? new Prisma.Decimal(0),
      description: `Aktivizim manual i planit ${plan.name}. ${input.note}`,
      status: 'ISSUED',
      dueAt: new Date(`${input.periodEnd}T00:00:00.000Z`),
    },
  });
  await prisma.subscriptionEvent.create({
    data: { firmId, subscriptionId: subscription.id, type: 'MANUAL_ACTIVATION', note: input.note, metadata: { invoiceId: invoice.id, plan: plan.code } },
  });
  await writeAudit({ firmId, userId: adminId, action: 'subscription.activated', summary: `Abonimi u aktivizua manualisht në planin ${plan.name}. Fatura mbetet e palikuiduar derisa të regjistrohet pagesa.` });
  return { subscription, invoice, paymentRecorded: false };
}

export async function recordBillingPayment(adminId: string, invoiceId: string, input: { amount: string; reference: string; receivedAt: string; note: string; confirm: boolean }) {
  if (!input.confirm) throw badRequest('Pagesa regjistrohet vetëm me konfirmim të qartë që është marrë jashtë sistemit.');
  if (!input.reference.trim()) throw badRequest('Referenca e pagesës është e detyrueshme.');
  const invoice = await prisma.billingInvoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  if (!invoice) throw notFound();
  const paid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)).plus(input.amount);
  const payment = await prisma.billingPayment.create({
    data: {
      billingInvoiceId: invoiceId,
      amount: input.amount,
      receivedAt: new Date(input.receivedAt),
      reference: input.reference.trim(),
      note: input.note,
      recordedById: adminId,
    },
  });
  if (paid.gte(invoice.amount) && invoice.amount.gt(0)) {
    await prisma.billingInvoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date(input.receivedAt) } });
  }
  await writeAudit({ firmId: invoice.firmId, userId: adminId, action: 'billing.payment_recorded', entityId: invoiceId, summary: 'U regjistrua një pagesë abonimi e marrë jashtë sistemit.' });
  return payment;
}

export async function supportGrant(adminId: string, input: { firmId: string; companyId?: string; grantedToUserId: string; reason: string; hours: number }) {
  if (input.reason.trim().length < 8) throw badRequest('Arsyeja e qasjes duhet të jetë e shkruar.');
  const grant = await prisma.supportAccessGrant.create({
    data: {
      firmId: input.firmId,
      companyId: input.companyId,
      grantedToUserId: input.grantedToUserId,
      grantedByUserId: adminId,
      reason: input.reason.trim(),
      expiresAt: new Date(Date.now() + input.hours * 60 * 60 * 1000),
    },
  });
  await writeAudit({ firmId: input.firmId, companyId: input.companyId, userId: adminId, action: 'platform.support_grant', entityId: grant.id, summary: 'U dha qasje e kufizuar mbështetjeje.', sensitive: true });
  return grant;
}

export async function grantedCompanyProfile(adminId: string, companyId: string) {
  const now = new Date();
  const grant = await prisma.supportAccessGrant.findFirst({
    where: { grantedToUserId: adminId, companyId, status: 'ACTIVE', expiresAt: { gt: now }, revokedAt: null },
  });
  if (!grant) throw new AppError('SUPPORT_GRANT_REQUIRED', 403, 'Qasja te të dhënat e kompanisë kërkon autorizim të kufizuar dhe të audituar.');
  const company = await prisma.clientCompany.findFirst({
    where: { id: companyId, firmId: grant.firmId },
    select: { id: true, legalName: true, status: true, municipality: true, vatStatus: true },
  });
  if (!company) throw notFound();
  await writeAudit({ firmId: grant.firmId, companyId, userId: adminId, action: 'platform.support_view', entityId: companyId, summary: 'U pa profili operacional i kompanisë gjatë qasjes së mbështetjes. Pa të dhëna financiare.', sensitive: true });
  return company;
}
