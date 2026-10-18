import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { assertBalanced, reverseLines } from '../domain/journal';
import { calculatePayroll, straightLineDepreciation, type TaxBracket } from '../domain/payroll';
import { writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/email';
import { asDate, dateOnly, todayISO } from '../lib/dates';
import { AppError, badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { randomToken, sha256 } from '../lib/tokens';
import { config } from '../config';
import { TAX_DISCLAIMER } from '../lib/chart';
import { assertMemberLimit, assertOpenPeriod, nextDocumentNumber, postJournal } from './posting';
import { vatSummary } from './reporting';
import type { CompanyActor, FirmActor } from '../types/express';

export async function partyList(actor: CompanyActor, kind: 'customer' | 'supplier', q?: string) {
  const where = {
    firmId: actor.firmId,
    companyId: actor.companyId,
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };
  return kind === 'customer'
    ? prisma.customer.findMany({ where, orderBy: { name: 'asc' }, take: 100 })
    : prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, take: 100 });
}

export async function saveParty(
  actor: CompanyActor,
  kind: 'customer' | 'supplier',
  input: { name: string; fiscalNumber?: string; vatNumber?: string; address?: string; municipality?: string; email?: string; phone?: string; notes?: string },
  id?: string,
) {
  const data = { ...input, name: input.name.trim(), email: input.email?.trim().toLowerCase() };
  if (id) {
    const existing = kind === 'customer'
      ? await prisma.customer.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } })
      : await prisma.supplier.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } });
    if (!existing) throw notFound();
    return kind === 'customer'
      ? prisma.customer.update({ where: { id }, data })
      : prisma.supplier.update({ where: { id }, data });
  }
  return kind === 'customer'
    ? prisma.customer.create({ data: { ...data, firmId: actor.firmId, companyId: actor.companyId } })
    : prisma.supplier.create({ data: { ...data, firmId: actor.firmId, companyId: actor.companyId } });
}

export async function listAccounts(actor: CompanyActor) {
  return prisma.account.findMany({ where: { firmId: actor.firmId, companyId: actor.companyId }, orderBy: { code: 'asc' } });
}

export async function createAccount(actor: CompanyActor, input: { code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; normalBalance: 'DEBIT' | 'CREDIT' }) {
  return prisma.account.create({
    data: { ...input, firmId: actor.firmId, companyId: actor.companyId, isSystem: false },
  });
}

export async function listJournals(actor: CompanyActor, page: number, pageSize: number) {
  const where = { firmId: actor.firmId, companyId: actor.companyId };
  const [total, rows] = await prisma.$transaction([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows };
}

export async function createDraftJournal(
  actor: CompanyActor,
  input: { date: string; description: string; lines: { accountId: string; debit: string; credit: string; description?: string }[] },
) {
  assertBalanced(input.lines);
  const accounts = await prisma.account.findMany({ where: { companyId: actor.companyId, firmId: actor.firmId, id: { in: input.lines.map((line) => line.accountId) } } });
  if (accounts.length !== new Set(input.lines.map((line) => line.accountId)).size) throw badRequest('Një llogari nuk i përket kësaj kompanie.');
  return prisma.journalEntry.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: asDate(input.date),
      description: input.description,
      status: 'DRAFT',
      sourceType: 'MANUAL',
      createdById: actor.userId,
      lines: {
        create: input.lines.map((line) => ({
          firmId: actor.firmId,
          companyId: actor.companyId,
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit || '0'),
          credit: new Prisma.Decimal(line.credit || '0'),
          description: line.description,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function postDraftJournal(actor: CompanyActor, id: string) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findFirst({
      where: { id, firmId: actor.firmId, companyId: actor.companyId, status: 'DRAFT' },
      include: { lines: true },
    });
    if (!entry) throw notFound('Regjistrimi nuk u gjet.');
    const lines = entry.lines.map((line) => ({ accountId: line.accountId, debit: line.debit.toString(), credit: line.credit.toString() }));
    assertBalanced(lines);
    const date = dateOnly(entry.date);
    await assertOpenPeriod(tx, actor.companyId, date);
    const number = await nextDocumentNumber(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      docType: 'JOURNAL',
      series: 'REG',
      fiscalYear: Number(date.slice(0, 4)),
    });
    const updated = await tx.journalEntry.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'POSTED', entryNumber: number, postedAt: new Date(), postedById: actor.userId },
    });
    if (updated.count !== 1) throw new AppError('JOURNAL_LOCKED', 409, 'Regjistrimi është postuar tashmë.');
    await writeAudit({ firmId: actor.firmId, companyId: actor.companyId, userId: actor.userId, action: 'journal.posted', entityType: 'JournalEntry', entityId: id, summary: `U postua regjistrimi ${number}.`, sensitive: true }, tx);
    return tx.journalEntry.findFirst({ where: { id }, include: { lines: true } });
  });
}

export async function reverseJournal(actor: CompanyActor, id: string) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findFirst({
      where: { id, firmId: actor.firmId, companyId: actor.companyId, status: 'POSTED' },
      include: { lines: true, reversedBy: true },
    });
    if (!entry) throw notFound('Regjistrimi nuk u gjet.');
    if (entry.reversedBy) throw badRequest('Regjistrimi është stornuar tashmë.');
    const reversed = await postJournal(tx, {
      firmId: actor.firmId,
      companyId: actor.companyId,
      date: todayISO(),
      description: `Stornim i regjistrimit ${entry.entryNumber ?? ''}`,
      sourceType: 'REVERSAL',
      sourceId: entry.id,
      createdById: actor.userId,
      lines: reverseLines(entry.lines.map((line) => ({ accountId: line.accountId, debit: line.debit.toString(), credit: line.credit.toString() }))),
    });
    await tx.journalEntry.update({ where: { id: reversed.entry.id }, data: { reversalOfId: entry.id } });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { status: 'REVERSED' } });
    await writeAudit({ firmId: actor.firmId, companyId: actor.companyId, userId: actor.userId, action: 'journal.reversed', entityType: 'JournalEntry', entityId: id, summary: 'Regjistrimi u stornua.', sensitive: true }, tx);
    return reversed.entry;
  });
}

export async function listPeriods(actor: CompanyActor) {
  return prisma.fiscalPeriod.findMany({ where: { firmId: actor.firmId, companyId: actor.companyId }, orderBy: { startDate: 'asc' } });
}

export async function setPeriod(actor: CompanyActor, id: string, action: 'close' | 'reopen') {
  const period = await prisma.fiscalPeriod.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } });
  if (!period) throw notFound('Periudha nuk u gjet.');
  const updated = await prisma.fiscalPeriod.update({
    where: { id },
    data: action === 'close' ? { status: 'CLOSED', closedAt: new Date(), closedById: actor.userId } : { status: 'OPEN', closedAt: null, closedById: null },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: action === 'close' ? 'period.closed' : 'period.reopened',
    entityType: 'FiscalPeriod',
    entityId: id,
    summary: action === 'close' ? `U mbyll periudha ${period.name}.` : `U rihap periudha ${period.name}.`,
    sensitive: true,
  });
  return updated;
}

export async function firmDashboard(actor: FirmActor, filters: { from?: string; to?: string; assigneeId?: string; companyId?: string; status?: string }) {
  const companyScope = actor.accessScope === 'ALL_COMPANIES'
    ? {}
    : { id: { in: (await prisma.companyAssignment.findMany({ where: { firmId: actor.firmId, userId: actor.userId }, select: { companyId: true } })).map((row) => row.companyId) } };
  const companies = await prisma.clientCompany.findMany({ where: { firmId: actor.firmId, ...companyScope }, select: { id: true, status: true, legalName: true } });
  const ids = filters.companyId ? companies.filter((company) => company.id === filters.companyId).map((company) => company.id) : companies.map((company) => company.id);
  const taskWhere = {
    firmId: actor.firmId,
    ...(ids.length ? { OR: [{ companyId: { in: ids } }, { companyId: null }] } : { companyId: { in: [] as string[] } }),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.status ? { status: filters.status as 'NEW' } : {}),
    ...(filters.from || filters.to ? { dueDate: { ...(filters.from ? { gte: asDate(filters.from) } : {}), ...(filters.to ? { lte: asDate(filters.to) } : {}) } } : {}),
  };
  const [tasks, overdueInvoices, draftInvoices, unreviewedPurchases, documentsThisWeek, subscription, activity, members] = await Promise.all([
    prisma.task.findMany({ where: taskWhere, include: { company: { select: { legalName: true } } }, orderBy: { dueDate: 'asc' }, take: 50 }),
    prisma.invoice.count({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'OVERDUE' } }),
    prisma.invoice.count({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'DRAFT' } }),
    prisma.purchaseInvoice.count({ where: { firmId: actor.firmId, companyId: { in: ids }, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
    prisma.document.count({ where: { firmId: actor.firmId, companyId: { in: ids }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.subscription.findUnique({ where: { firmId: actor.firmId }, include: { plan: true } }),
    prisma.auditLog.findMany({ where: { firmId: actor.firmId, OR: [{ companyId: { in: ids } }, { companyId: null }] }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, action: true, summary: true, createdAt: true, companyId: true } }),
    prisma.firmMembership.findMany({ where: { firmId: actor.firmId, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true } }, role: true } }),
  ]);
  const openRequests = await prisma.documentRequest.count({ where: { firmId: actor.firmId, companyId: { in: ids }, status: 'OPEN' } });
  const workload = await Promise.all(members.map(async (member) => ({
    userId: member.user.id,
    name: member.user.name,
    role: member.role.name,
    openTasks: await prisma.task.count({ where: { firmId: actor.firmId, assigneeId: member.user.id, status: { not: 'COMPLETED' } } }),
  })));
  const byStatus = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    companiesTotal: companies.length,
    activeCompanies: companies.filter((company) => company.status === 'ACTIVE').length,
    pendingCompanies: companies.filter((company) => company.status === 'PENDING').length,
    missingDocuments: openRequests,
    overdueInvoices,
    draftInvoices,
    unreviewedPurchases,
    documentsThisWeek,
    tasks: tasks.map((task) => ({ ...task, companyName: task.company?.legalName ?? null })),
    tasksByStatus: byStatus,
    workload,
    subscription: subscription ? { status: subscription.status, plan: subscription.plan.name, trialEndsAt: subscription.trialEndsAt, readOnly: subscription.readOnly, maxCompanies: subscription.plan.maxCompanies, maxMembers: subscription.plan.maxMembers } : null,
    activity,
    companies: companies.slice(0, 8),
  };
}

export async function listTasks(actor: FirmActor, query: { companyId?: string; status?: string; assigneeId?: string; page: number; pageSize: number }) {
  const where = {
    firmId: actor.firmId,
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.status ? { status: query.status as 'NEW' } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.task.count({ where }),
    prisma.task.findMany({ where, include: { comments: true, company: { select: { legalName: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  return { total, rows };
}

export async function saveTask(actor: FirmActor, input: { title: string; description?: string; companyId?: string; assigneeId?: string; dueDate?: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; status?: 'NEW' | 'IN_PROGRESS' | 'WAITING_DOCUMENTS' | 'IN_REVIEW' | 'COMPLETED' | 'OVERDUE'; serviceType?: string }, id?: string) {
  if (input.companyId) {
    const company = await prisma.clientCompany.findFirst({ where: { id: input.companyId, firmId: actor.firmId } });
    if (!company) throw notFound('Kompania nuk u gjet.');
  }
  const data = {
    title: input.title,
    description: input.description,
    companyId: input.companyId,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate ? asDate(input.dueDate) : undefined,
    priority: input.priority,
    status: input.status,
    serviceType: input.serviceType,
    completedAt: input.status === 'COMPLETED' ? new Date() : undefined,
  };
  if (id) {
    const existing = await prisma.task.findFirst({ where: { id, firmId: actor.firmId } });
    if (!existing) throw notFound('Detyra nuk u gjet.');
  }
  const task = id
    ? await prisma.task.update({ where: { id }, data })
    : await prisma.task.create({ data: { ...data, firmId: actor.firmId, title: input.title, createdById: actor.userId } });
  if (input.assigneeId) await notify(input.assigneeId, actor.firmId, input.companyId, 'TASK', 'Detyrë e caktuar', input.title, `task:${task.id}:${input.assigneeId}`);
  return task;
}

export async function commentTask(actor: FirmActor, taskId: string, body: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, firmId: actor.firmId } });
  if (!task) throw notFound();
  return prisma.taskComment.create({ data: { taskId, authorId: actor.userId, body } });
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 });
}

export async function markNotification(userId: string, id: string) {
  const item = await prisma.notification.findFirst({ where: { id, userId } });
  if (!item) throw notFound();
  return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function searchAll(actor: FirmActor, q: string, companyId?: string) {
  const term = q.trim();
  if (term.length < 2) return { companies: [], invoices: [], customers: [], suppliers: [], payments: [], documents: [], tasks: [] };
  const companyFilter = companyId ? { companyId } : {};
  const [companies, invoices, customers, suppliers, payments, documents, tasks] = await Promise.all([
    prisma.clientCompany.findMany({ where: { firmId: actor.firmId, OR: [{ legalName: { contains: term, mode: 'insensitive' } }, { fiscalNumber: { contains: term, mode: 'insensitive' } }] }, take: 8 }),
    prisma.invoice.findMany({ where: { firmId: actor.firmId, ...companyFilter, displayNumber: { contains: term, mode: 'insensitive' } }, take: 8 }),
    prisma.customer.findMany({ where: { firmId: actor.firmId, ...companyFilter, name: { contains: term, mode: 'insensitive' } }, take: 8 }),
    prisma.supplier.findMany({ where: { firmId: actor.firmId, ...companyFilter, name: { contains: term, mode: 'insensitive' } }, take: 8 }),
    prisma.payment.findMany({ where: { firmId: actor.firmId, ...companyFilter, reference: { contains: term, mode: 'insensitive' } }, take: 8 }),
    prisma.document.findMany({ where: { firmId: actor.firmId, ...companyFilter, originalName: { contains: term, mode: 'insensitive' } }, take: 8 }),
    prisma.task.findMany({ where: { firmId: actor.firmId, ...(companyId ? { companyId } : {}), title: { contains: term, mode: 'insensitive' } }, take: 8 }),
  ]);
  return { companies, invoices, customers, suppliers, payments, documents, tasks };
}

export async function inviteMember(actor: FirmActor, input: { email: string; roleKey: string; companyId?: string; kind: 'FIRM' | 'CLIENT' }) {
  await assertMemberLimit(actor.firmId);
  if (input.kind === 'CLIENT') {
    const allowed = await prisma.planEntitlement.findFirst({ where: { plan: { subscriptions: { some: { firmId: actor.firmId } } }, featureKey: 'portal', enabled: true } });
    if (!allowed) throw new AppError('FEATURE_DISABLED', 403, 'Portali i klientit nuk përfshihet në plan.');
    if (!input.companyId) throw badRequest('Zgjidhni kompaninë e klientit.');
  }
  const role = await prisma.role.findFirst({ where: { key: input.roleKey, OR: [{ scopeKey: 'system' }, { firmId: actor.firmId }] } });
  if (input.kind === 'FIRM' && !role) throw badRequest('Roli nuk u gjet.');
  const token = randomToken();
  await prisma.invitation.create({
    data: {
      firmId: actor.firmId,
      companyId: input.companyId,
      email: input.email.toLowerCase(),
      roleKey: input.kind === 'CLIENT' ? 'CLIENT_VIEWER' : input.roleKey,
      kind: input.kind,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdById: actor.userId,
    },
  });
  const link = `${config.appUrl}/ftesa?token=${token}`;
  await sendEmail({ to: input.email, subject: 'Ftesë — Kontabiliteti Pro', body: `Hapni ftesën:\n${link}`, firmId: actor.firmId });
  await writeAudit({ firmId: actor.firmId, companyId: input.companyId, userId: actor.userId, action: 'invitation.created', summary: `U ftua ${input.email}.`, sensitive: true });
  return { sent: true, devInvitationToken: config.exposeDevTokens ? token : undefined };
}

export async function acceptInvitation(input: { token: string; name?: string; password?: string }) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: sha256(input.token) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) throw badRequest('Ftesa nuk është e vlefshme.');
  let user = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (!user) {
    if (!input.name || !input.password) throw badRequest('Emri dhe fjalëkalimi janë të nevojshëm për llogarinë e re.');
    const { hashPassword, assertPasswordStrength } = await import('../lib/passwords');
    assertPasswordStrength(input.password);
    user = await prisma.user.create({ data: { email: invitation.email, name: input.name, passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() } });
  }
  if (invitation.kind === 'CLIENT') {
    if (!invitation.companyId) throw badRequest('Ftesa e klientit nuk ka kompani.');
    await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
      update: { status: 'ACTIVE' },
      create: { companyId: invitation.companyId, firmId: invitation.firmId, userId: user.id },
    });
  } else {
    const role = await prisma.role.findFirst({ where: { key: invitation.roleKey, OR: [{ scopeKey: 'system' }, { firmId: invitation.firmId }] } });
    if (!role) throw badRequest('Roli i ftesës nuk ekziston.');
    await prisma.firmMembership.upsert({
      where: { firmId_userId: { firmId: invitation.firmId, userId: user.id } },
      update: { status: 'ACTIVE', roleId: role.id },
      create: { firmId: invitation.firmId, userId: user.id, roleId: role.id },
    });
  }
  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  await writeAudit({ firmId: invitation.firmId, companyId: invitation.companyId, userId: user.id, action: 'invitation.accepted', summary: 'Ftesa u pranua.' });
  return { accepted: true };
}

export async function updateMember(actor: FirmActor, membershipId: string, input: { roleKey?: string; status?: 'ACTIVE' | 'DEACTIVATED'; overrides?: { permissionKey: string; effect: 'ALLOW' | 'DENY' }[] }) {
  const membership = await prisma.firmMembership.findFirst({ where: { id: membershipId, firmId: actor.firmId } });
  if (!membership) throw notFound();
  if (input.roleKey) {
    const role = await prisma.role.findFirst({ where: { key: input.roleKey, OR: [{ scopeKey: 'system' }, { firmId: actor.firmId }] } });
    if (!role) throw badRequest('Roli nuk u gjet.');
    await prisma.firmMembership.update({ where: { id: membershipId }, data: { roleId: role.id } });
  }
  if (input.status) await prisma.firmMembership.update({ where: { id: membershipId }, data: { status: input.status } });
  if (input.overrides) {
    await prisma.membershipPermissionOverride.deleteMany({ where: { membershipId } });
    await prisma.membershipPermissionOverride.createMany({ data: input.overrides.map((override) => ({ membershipId, ...override })) });
  }
  await writeAudit({ firmId: actor.firmId, userId: actor.userId, action: 'membership.updated', entityId: membershipId, summary: 'U ndryshuan lejet e anëtarit.', sensitive: true });
}

export async function subscriptionView(firmId: string) {
  return prisma.subscription.findUnique({
    where: { firmId },
    include: { plan: { include: { entitlements: true } }, events: { orderBy: { createdAt: 'desc' }, take: 20 }, billingInvoices: { include: { payments: true }, orderBy: { issuedAt: 'desc' } } },
  });
}

export async function requestCancellation(actor: FirmActor) {
  const subscription = await prisma.subscription.findUnique({ where: { firmId: actor.firmId } });
  if (!subscription) throw notFound();
  const updated = await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } });
  await prisma.subscriptionEvent.create({ data: { firmId: actor.firmId, subscriptionId: subscription.id, type: 'CANCELLATION_REQUESTED', note: 'Kërkesë anulimi. Regjistrimet financiare nuk fshihen.' } });
  await writeAudit({ firmId: actor.firmId, userId: actor.userId, action: 'subscription.cancel_requested', summary: 'U kërkua anulimi i abonimit.' });
  return updated;
}

export async function confirmTaxRate(actor: CompanyActor, id: string, note: string) {
  const rate = await prisma.taxRate.findFirst({ where: { id, companyId: actor.companyId, firmId: actor.firmId } });
  if (!rate) throw notFound();
  if (note.trim().length < 8) throw badRequest('Shënoni që e keni verifikuar normën me burimin zyrtar.');
  const updated = await prisma.taxRate.update({
    where: { id },
    data: { userConfirmedAt: new Date(), userConfirmedById: actor.userId, confirmationNote: note.trim() },
  });
  await writeAudit({ firmId: actor.firmId, companyId: actor.companyId, userId: actor.userId, action: 'tax.rate_confirmed', entityId: id, summary: `Përdoruesi konfirmoi normën ${rate.code}. Kjo nuk është verifikim automatik me ATK.`, sensitive: true });
  return updated;
}

export async function createTaxReport(actor: CompanyActor, from: string, to: string) {
  const summary = await vatSummary(actor, from, to);
  return prisma.taxReport.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      periodStart: asDate(from),
      periodEnd: asDate(to),
      status: 'INTERNAL_DRAFT',
      salesNet: summary.salesNet,
      salesVat: summary.salesVat,
      purchaseNet: summary.purchaseNet,
      purchaseVat: summary.purchaseVat,
      deductibleVat: summary.deductibleVat,
      nonDeductibleVat: summary.nonDeductibleVat,
      exemptSales: summary.exemptSales,
      vatPosition: summary.vatPosition,
      disclaimer: TAX_DISCLAIMER,
      createdById: actor.userId,
    },
  });
}

export async function reviewTaxReport(actor: CompanyActor, id: string, notes?: string) {
  const report = await ownedReport(actor, id);
  if (report.status !== 'INTERNAL_DRAFT') throw badRequest('Vetëm drafti i brendshëm shqyrtohet.');
  return prisma.taxReport.update({ where: { id }, data: { status: 'REVIEWED_BY_ACCOUNTANT', reviewedAt: new Date(), reviewedById: actor.userId, notes } });
}

export async function markTaxExternal(actor: CompanyActor, id: string, note: string) {
  const report = await ownedReport(actor, id);
  if (report.status !== 'REVIEWED_BY_ACCOUNTANT') throw badRequest('Së pari raporti duhet shqyrtuar nga kontabilisti.');
  if (note.trim().length < 8) throw badRequest('Shënoni referencën e dorëzimit të bërë jashtë programit.');
  return prisma.taxReport.update({
    where: { id },
    data: {
      status: 'MARKED_EXTERNALLY_SUBMITTED',
      externalMarkedAt: new Date(),
      externalMarkedById: actor.userId,
      externalReferenceNote: note.trim(),
    },
  });
}

async function ownedReport(actor: CompanyActor, id: string) {
  const report = await prisma.taxReport.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } });
  if (!report) throw notFound();
  return report;
}

export async function saveDocument(actor: { firmId: string; companyId: string; userId: string }, file: { storedName: string; originalName: string; mimeType: string; sizeBytes: number }, input: { category: string; periodMonth?: number; periodYear?: number; notes?: string; purchaseInvoiceId?: string; sharedWithClient?: boolean }) {
  const document = await prisma.document.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      uploadedById: actor.userId,
      category: input.category,
      periodMonth: input.periodMonth,
      periodYear: input.periodYear,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      notes: input.notes,
      purchaseInvoiceId: input.purchaseInvoiceId,
      sharedWithClient: input.sharedWithClient ?? false,
    },
  });
  if (input.periodMonth && input.periodYear) {
    await prisma.documentRequest.updateMany({
      where: { companyId: actor.companyId, category: input.category, periodMonth: input.periodMonth, periodYear: input.periodYear, status: 'OPEN' },
      data: { status: 'RECEIVED' },
    });
  }
  const assignees = await prisma.companyAssignment.findMany({ where: { companyId: actor.companyId, firmId: actor.firmId } });
  for (const assignee of assignees) {
    await notify(assignee.userId, actor.firmId, actor.companyId, 'DOCUMENT_RECEIVED', 'Dokument i ri', file.originalName, `doc:${document.id}:${assignee.userId}`);
  }
  return document;
}

export async function getOwnedDocument(actor: { firmId: string; companyId: string }, id: string) {
  const document = await prisma.document.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } });
  if (!document) throw notFound('Dokumenti nuk u gjet.');
  return document;
}

export async function updateDocument(actor: CompanyActor, id: string, input: { status?: 'RECEIVED' | 'IN_REVIEW' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION' | 'PROCESSED'; notes?: string; sharedWithClient?: boolean }) {
  await getOwnedDocument(actor, id);
  const document = await prisma.document.update({ where: { id }, data: input });
  if (input.status === 'NEEDS_CLARIFICATION') {
    const members = await prisma.companyMembership.findMany({ where: { companyId: actor.companyId, status: 'ACTIVE' } });
    for (const member of members) await notify(member.userId, actor.firmId, actor.companyId, 'CLARIFICATION', 'Kërkohet sqarim', input.notes || document.originalName, `clarify:${document.id}:${member.userId}`);
  }
  return document;
}

export async function requestDocument(actor: CompanyActor, input: { category: string; periodMonth?: number; periodYear?: number; message: string; dueDate?: string }) {
  return prisma.documentRequest.create({
    data: { firmId: actor.firmId, companyId: actor.companyId, requestedById: actor.userId, ...input, dueDate: input.dueDate ? asDate(input.dueDate) : undefined },
  });
}

export async function savePayrollRule(actor: CompanyActor, input: { name: string; effectiveFrom: string; pensionEmployeePercent: string; pensionEmployerPercent: string; taxBase: 'GROSS' | 'GROSS_MINUS_EMPLOYEE_PENSION'; brackets: TaxBracket[]; sourceNote: string }) {
  return prisma.payrollRuleSet.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      name: input.name,
      effectiveFrom: asDate(input.effectiveFrom),
      pensionEmployeePercent: input.pensionEmployeePercent,
      pensionEmployerPercent: input.pensionEmployerPercent,
      taxBase: input.taxBase,
      brackets: input.brackets,
      sourceNote: input.sourceNote,
      isActive: false,
    },
  });
}

export async function confirmPayrollRule(actor: CompanyActor, id: string, note: string) {
  const rule = await prisma.payrollRuleSet.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId } });
  if (!rule) throw notFound();
  if (note.trim().length < 8) throw badRequest('Konfirmimi duhet të përmendë burimin e verifikuar nga kontabilisti.');
  return prisma.payrollRuleSet.update({ where: { id }, data: { isActive: true, userConfirmedAt: new Date(), userConfirmedById: actor.userId, confirmationNote: note.trim() } });
}

export async function runPayroll(actor: CompanyActor, input: { ruleSetId: string; periodStart: string; periodEnd: string }) {
  const rule = await prisma.payrollRuleSet.findFirst({ where: { id: input.ruleSetId, firmId: actor.firmId, companyId: actor.companyId, isActive: true } });
  if (!rule?.userConfirmedAt) throw new AppError('PAYROLL_UNCONFIRMED', 409, 'Seti i rregullave të pagës duhet konfirmuar para llogaritjes.');
  const employees = await prisma.employee.findMany({ where: { firmId: actor.firmId, companyId: actor.companyId, isActive: true } });
  const lines = employees.map((employee) => {
    const result = calculatePayroll({
      gross: employee.grossSalary.toString(),
      pensionEmployeePercent: rule.pensionEmployeePercent.toString(),
      pensionEmployerPercent: rule.pensionEmployerPercent.toString(),
      taxBase: rule.taxBase,
      brackets: rule.brackets as TaxBracket[],
    });
    return { employeeId: employee.id, ...result };
  });
  const total = (key: 'gross' | 'net' | 'tax' | 'pensionEmployee' | 'pensionEmployer') => lines.reduce((sum, line) => sum.plus(line[key]), new Prisma.Decimal(0));
  return prisma.payrollRun.create({
    data: {
      firmId: actor.firmId,
      companyId: actor.companyId,
      periodStart: asDate(input.periodStart),
      periodEnd: asDate(input.periodEnd),
      status: 'CALCULATED',
      ruleSetId: rule.id,
      totalGross: total('gross'),
      totalNet: total('net'),
      totalTax: total('tax'),
      totalPensionEmployee: total('pensionEmployee'),
      totalPensionEmployer: total('pensionEmployer'),
      createdById: actor.userId,
      lines: {
        create: lines.map((line) => ({
          employeeId: line.employeeId,
          firmId: actor.firmId,
          companyId: actor.companyId,
          gross: line.gross,
          pensionEmployee: line.pensionEmployee,
          pensionEmployer: line.pensionEmployer,
          taxableBase: line.taxableBase,
          tax: line.tax,
          net: line.net,
          calculation: { bands: line.bands, formula: rule.taxBase, sourceNote: rule.sourceNote },
        })),
      },
    },
    include: { lines: true },
  });
}

export async function saveAsset(actor: CompanyActor, input: { name: string; acquiredOn: string; acquisitionCost: string; residualValue?: string; usefulLifeMonths: number; policyNote: string }) {
  const monthly = straightLineDepreciation({ cost: input.acquisitionCost, residual: input.residualValue ?? '0', usefulLifeMonths: input.usefulLifeMonths });
  return { asset: await prisma.fixedAsset.create({ data: { firmId: actor.firmId, companyId: actor.companyId, name: input.name, acquiredOn: asDate(input.acquiredOn), acquisitionCost: input.acquisitionCost, residualValue: input.residualValue ?? '0', usefulLifeMonths: input.usefulLifeMonths, policyNote: input.policyNote } }), monthlyDepreciation: monthly };
}

export async function depreciateAsset(actor: CompanyActor, assetId: string, periodStart: string, periodEnd: string) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, firmId: actor.firmId, companyId: actor.companyId, status: 'ACTIVE' } });
  if (!asset) throw notFound();
  const amount = straightLineDepreciation({ cost: asset.acquisitionCost.toString(), residual: asset.residualValue.toString(), usefulLifeMonths: asset.usefulLifeMonths });
  const nextAccumulated = new Prisma.Decimal(asset.accumulatedDepreciation).plus(amount);
  const depreciable = new Prisma.Decimal(asset.acquisitionCost).minus(asset.residualValue);
  if (nextAccumulated.gt(depreciable)) throw badRequest('Amortizimi do ta kalonte vlerën e amortizueshme.');
  return prisma.$transaction(async (tx) => {
    const entry = await tx.depreciationEntry.create({
      data: { assetId, firmId: actor.firmId, companyId: actor.companyId, periodStart: asDate(periodStart), periodEnd: asDate(periodEnd), amount },
    });
    await tx.fixedAsset.update({ where: { id: assetId }, data: { accumulatedDepreciation: nextAccumulated } });
    return entry;
  });
}

export async function importCustomers(actor: CompanyActor, fileName: string, csv: string, createdById: string) {
  const rows = parseCsv(csv);
  const errors: { row: number; message: string }[] = [];
  const preview = rows.map((row, index) => {
    const name = row.emri || row.name;
    if (!name) errors.push({ row: index + 2, message: 'Mungon emri.' });
    return { name, email: row.email, phone: row.telefoni || row.phone, fiscalNumber: row.numri_fiskal || row.fiscalNumber, address: row.adresa || row.address, municipality: row.komuna || row.municipality };
  });
  const batch = await prisma.importBatch.create({
    data: { firmId: actor.firmId, companyId: actor.companyId, type: 'CUSTOMERS', status: errors.length ? 'FAILED' : 'PREVIEW', fileName, summary: { preview, errors }, createdById },
  });
  return batch;
}

export async function commitImport(actor: CompanyActor, id: string) {
  const batch = await prisma.importBatch.findFirst({ where: { id, firmId: actor.firmId, companyId: actor.companyId, status: 'PREVIEW' } });
  if (!batch) throw badRequest('Importi nuk është gati për konfirmim.');
  const summary = batch.summary as { preview: { name?: string; email?: string; phone?: string; fiscalNumber?: string; address?: string; municipality?: string }[]; errors: unknown[] };
  if (summary.errors?.length) throw badRequest('Importi ka gabime dhe nuk postohet.');
  let created = 0;
  let skipped = 0;
  for (const row of summary.preview) {
    if (!row.name) continue;
    const duplicate = row.fiscalNumber
      ? await prisma.customer.findFirst({ where: { companyId: actor.companyId, fiscalNumber: row.fiscalNumber } })
      : await prisma.customer.findFirst({ where: { companyId: actor.companyId, name: row.name } });
    if (duplicate) {
      skipped += 1;
      continue;
    }
    await prisma.customer.create({ data: { firmId: actor.firmId, companyId: actor.companyId, name: row.name, email: row.email, phone: row.phone, fiscalNumber: row.fiscalNumber, address: row.address, municipality: row.municipality } });
    created += 1;
  }
  return prisma.importBatch.update({
    where: { id },
    data: { status: 'COMMITTED', committedAt: new Date(), summary: { ...summary, created, skipped } as Prisma.InputJsonValue },
  });
}

export async function importBankStatement(actor: CompanyActor, bankAccountId: string, csv: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, firmId: actor.firmId, companyId: actor.companyId } });
  if (!account) throw notFound('Llogaria bankare nuk u gjet.');
  const rows = parseCsv(csv);
  const created = [];
  const duplicates = [];
  for (const row of rows) {
    const bookedOn = normalizeDate(row.data || row.date);
    const amount = (row.shuma || row.amount || '0').replace(',', '.');
    const description = row.pershkrimi || row.description || 'Pa përshkrim';
    const reference = row.referenca || row.reference || '';
    const fingerprint = createHash('sha256').update(`${bankAccountId}|${bookedOn}|${amount}|${reference}|${description}`).digest('hex');
    const existing = await prisma.bankTransaction.findUnique({ where: { bankAccountId_fingerprint: { bankAccountId, fingerprint } } });
    if (existing) {
      duplicates.push(fingerprint);
      continue;
    }
    created.push(await prisma.bankTransaction.create({
      data: { firmId: actor.firmId, companyId: actor.companyId, bankAccountId, bookedOn: asDate(bookedOn), description, amount, reference, fingerprint },
    }));
  }
  return { created: created.length, duplicates: duplicates.length, connected: false, note: 'Llogaria nuk është e lidhur automatikisht me bankën. Këto janë transaksione të importuara.' };
}

export async function globalSearchSafe(actor: FirmActor, q: string) {
  return searchAll(actor, q);
}

async function notify(userId: string, firmId: string | undefined, companyId: string | undefined, type: string, title: string, body: string, dedupeKey: string) {
  await prisma.notification.upsert({
    where: { userId_dedupeKey: { userId, dedupeKey } },
    update: {},
    create: { userId, firmId, companyId, type, title, body, dedupeKey },
  });
}

function parseCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim().replace(/^"|"$/g, '');
    });
    return row;
  });
}

function normalizeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) throw badRequest(`Data ${value} nuk është e vlefshme.`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}
