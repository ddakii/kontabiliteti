import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { pageParams, sendData, sendPage, serialize } from '../lib/http';
import { prisma } from '../lib/prisma';
import { KOSOVO_MUNICIPALITIES } from '../lib/chart';
import { openPrivateFile, storePrivateFile } from '../lib/storage';
import { writeAudit } from '../lib/audit';
import { AppError } from '../lib/errors';
import { requireAuth, requireCompany, requireFirm, requirePermission, requireVerified, parseBody } from '../middleware/security';
import { archiveCompany, assignAccountant, companyHealth, createCompany, getCompany, listCompanies, postOpeningBalances, updateCompany } from '../services/companies';
import { createCreditNote, createInvoice, duplicateInvoice, emailInvoice, finalizeInvoice, getInvoice, listInvoices, previewInvoice, updateDraft } from '../services/invoices';
import { createPayment, listPayments, reversePayment } from '../services/payments';
import { createPurchase, getPurchase, listPurchases, postPurchase, reviewPurchase } from '../services/purchases';
import { renderInvoicePdf } from '../services/pdf';
import { buildReport, csvFor, workbookFor } from '../services/reporting';
import {
  agingReport,
  bankWorkspace,
  companyDirectory,
  companyReadiness,
  confirmBankMatch,
  documentInbox,
  ensureMonthChecklist,
  firmAudit,
  updateMonthItem,
  workQueue,
} from '../services/operations';
import { fiscalRouter } from './fiscal';
import {
  commentTask,
  commitImport,
  confirmPayrollRule,
  confirmTaxRate,
  createAccount,
  createDraftJournal,
  createTaxReport,
  depreciateAsset,
  firmDashboard,
  getOwnedDocument,
  importBankStatement,
  importCustomers,
  inviteMember,
  listAccounts,
  listJournals,
  listNotifications,
  listPeriods,
  listTasks,
  markNotification,
  markTaxExternal,
  partyList,
  postDraftJournal,
  requestCancellation,
  requestDocument,
  reviewTaxReport,
  reverseJournal,
  runPayroll,
  saveAsset,
  saveDocument,
  saveParty,
  savePayrollRule,
  saveTask,
  searchAll,
  setPeriod,
  subscriptionView,
  updateDocument,
  updateMember,
} from '../services/office';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });
const lineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.string().min(1),
  unitPrice: z.string().min(1),
  discountPercent: z.string().optional(),
  vatPercent: z.string().optional(),
  treatment: z.enum(['STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUT_OF_SCOPE']).optional(),
  taxRateId: z.string().uuid().optional(),
  deductible: z.boolean().optional(),
});
const invoiceBody = z.object({
  customerId: z.string().uuid().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).optional(),
  notes: z.string().max(2000).optional(),
  paymentTerms: z.string().max(500).optional(),
  paymentInstructions: z.string().max(1000).optional(),
  lines: z.array(lineSchema).min(1),
});

export const portalRouter = Router();
portalRouter.use(requireAuth);

portalRouter.get('/companies', async (req, res, next) => {
  try {
    const rows = await prisma.companyMembership.findMany({
      where: { userId: req.auth!.userId, status: 'ACTIVE' },
      include: { company: { select: { id: true, legalName: true, firmId: true, municipality: true } } },
    });
    sendData(res, rows);
  } catch (error) {
    next(error);
  }
});

portalRouter.get('/companies/:companyId/documents', async (req, res, next) => {
  try {
    await assertPortal(req.auth!.userId, param(req, 'companyId'));
    sendData(res, await prisma.document.findMany({
      where: { companyId: param(req, 'companyId'), OR: [{ sharedWithClient: true }, { uploadedById: req.auth!.userId }] },
      orderBy: { createdAt: 'desc' },
    }));
  } catch (error) {
    next(error);
  }
});

portalRouter.post('/companies/:companyId/documents', upload.single('file'), async (req, res, next) => {
  try {
    const membership = await assertPortal(req.auth!.userId, param(req, 'companyId'));
    if (!membership.canUpload || !req.file) throw new AppError('FORBIDDEN', 403, 'Ngarkimi nuk lejohet.');
    const stored = await storePrivateFile(membership.firmId, membership.companyId, req.file);
    const document = await saveDocument(
      { firmId: membership.firmId, companyId: membership.companyId, userId: req.auth!.userId },
      stored,
      { category: String(req.body.category || 'OTHER'), periodMonth: numberOrUndefined(req.body.periodMonth), periodYear: numberOrUndefined(req.body.periodYear), notes: req.body.notes },
    );
    sendData(res, document, 201);
  } catch (error) {
    next(error);
  }
});

portalRouter.get('/companies/:companyId/requests', async (req, res, next) => {
  try {
    await assertPortal(req.auth!.userId, param(req, 'companyId'));
    sendData(res, await prisma.documentRequest.findMany({ where: { companyId: param(req, 'companyId'), status: 'OPEN' } }));
  } catch (error) {
    next(error);
  }
});

portalRouter.get('/companies/:companyId/reports', async (req, res, next) => {
  try {
    const membership = await assertPortal(req.auth!.userId, param(req, 'companyId'));
    if (!membership.canViewSharedReports) throw new AppError('FORBIDDEN', 403, 'Raportet e ndara nuk janë të lejuara.');
    sendData(res, await prisma.publishedReport.findMany({ where: { companyId: param(req, 'companyId'), sharedWithClient: true }, orderBy: { createdAt: 'desc' } }));
  } catch (error) {
    next(error);
  }
});

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth, requireFirm, requireVerified);

workspaceRouter.get('/municipalities', (_req, res) => sendData(res, KOSOVO_MUNICIPALITIES));
workspaceRouter.get('/work-queue', async (req, res, next) => {
  try { sendData(res, await workQueue(req.firm!)); } catch (error) { next(error); }
});
workspaceRouter.get('/directory', async (req, res, next) => {
  try { sendData(res, await companyDirectory(req.firm!)); } catch (error) { next(error); }
});
workspaceRouter.get('/companies/:companyId/readiness', async (req, res, next) => {
  try { sendData(res, await companyReadiness(req.firm!, param(req, 'companyId'))); } catch (error) { next(error); }
});
workspaceRouter.get('/document-inbox', requirePermission('documents.read'), async (req, res, next) => {
  try { sendData(res, await documentInbox(req.firm!)); } catch (error) { next(error); }
});
workspaceRouter.get('/audit', requirePermission('reports.read'), async (req, res, next) => {
  try { sendData(res, await firmAudit(req.firm!)); } catch (error) { next(error); }
});
workspaceRouter.get('/dashboard', async (req, res, next) => {
  try {
    sendData(res, await firmDashboard(req.firm!, { from: q(req, 'from'), to: q(req, 'to'), assigneeId: q(req, 'assigneeId'), companyId: q(req, 'companyId'), status: q(req, 'status') }));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/subscription', async (req, res, next) => {
  try {
    sendData(res, await subscriptionView(req.firm!.firmId));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/subscription/cancel', requirePermission('firm.billing'), async (req, res, next) => {
  try {
    sendData(res, await requestCancellation(req.firm!));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/plans', async (_req, res, next) => {
  try {
    sendData(res, await prisma.subscriptionPlan.findMany({ where: { isPublic: true, isActive: true }, include: { entitlements: true }, orderBy: { sortOrder: 'asc' } }));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/members', requirePermission('firm.members'), async (req, res, next) => {
  try {
    sendData(res, await prisma.firmMembership.findMany({ where: { firmId: req.firm!.firmId }, include: { user: { select: { id: true, name: true, email: true } }, role: true, overrides: true, assignments: true } }));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/invitations', requirePermission('firm.members'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ email: z.string().email(), roleKey: z.string(), companyId: z.string().uuid().optional(), kind: z.enum(['FIRM', 'CLIENT']) }), req.body);
    sendData(res, await inviteMember(req.firm!, body), 201);
  } catch (error) {
    next(error);
  }
});
workspaceRouter.patch('/members/:id', requirePermission('firm.members'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ roleKey: z.string().optional(), status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(), overrides: z.array(z.object({ permissionKey: z.string(), effect: z.enum(['ALLOW', 'DENY']) })).optional() }), req.body);
    await updateMember(req.firm!, param(req, 'id'), body);
    sendData(res, { updated: true });
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/companies', async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listCompanies(req.firm!, { q: q(req, 'q'), status: q(req, 'status'), page: page.page, pageSize: page.pageSize });
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/companies', requirePermission('companies.create'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      legalName: z.string().min(2),
      tradeName: z.string().optional(),
      businessNumber: z.string().optional(),
      fiscalNumber: z.string().optional(),
      vatNumber: z.string().optional(),
      address: z.string().optional(),
      municipality: z.string().optional(),
      contactName: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      activity: z.string().optional(),
      vatStatus: z.enum(['REGISTERED', 'NOT_REGISTERED', 'EXEMPT', 'UNKNOWN']).optional(),
      accountingStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
      servicePackage: z.string().optional(),
      assignedUserId: z.string().uuid().optional(),
      notes: z.string().optional(),
    }), req.body);
    sendData(res, await createCompany(req.firm!, { ...body, email: body.email || undefined }, req.ip, req.correlationId), 201);
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/companies/:companyId', async (req, res, next) => {
  try {
    sendData(res, await getCompany(req.firm!, param(req, 'companyId')));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/companies/:companyId/health', async (req, res, next) => {
  try {
    sendData(res, await companyHealth(req.firm!, param(req, 'companyId')));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.patch('/companies/:companyId', requirePermission('companies.update'), async (req, res, next) => {
  try {
    sendData(res, await updateCompany(req.firm!, param(req, 'companyId'), req.body, req.ip));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/companies/:companyId/archive', requirePermission('companies.archive'), async (req, res, next) => {
  try {
    sendData(res, await archiveCompany(req.firm!, param(req, 'companyId'), req.ip));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/companies/:companyId/assignments', requirePermission('companies.assign'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ userId: z.string().uuid() }), req.body);
    await assignAccountant(req.firm!, param(req, 'companyId'), body.userId);
    sendData(res, { assigned: true });
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/companies/:companyId/opening-balances', requireCompany, requirePermission('accounting.post'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), lines: z.array(z.object({ accountCode: z.string(), debit: z.string(), credit: z.string() })).min(2) }), req.body);
    sendData(res, await postOpeningBalances(req.firm!, req.company!.companyId, body), 201);
  } catch (error) {
    next(error);
  }
});

workspaceRouter.get('/notifications', async (req, res, next) => {
  try {
    sendData(res, await listNotifications(req.auth!.userId));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/notifications/:id/read', async (req, res, next) => {
  try {
    sendData(res, await markNotification(req.auth!.userId, param(req, 'id')));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/search', async (req, res, next) => {
  try {
    sendData(res, await searchAll(req.firm!, q(req, 'q') ?? '', q(req, 'companyId')));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.get('/tasks', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listTasks(req.firm!, { companyId: q(req, 'companyId'), status: q(req, 'status'), assigneeId: q(req, 'assigneeId'), page: page.page, pageSize: page.pageSize });
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/tasks', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ title: z.string().min(2), description: z.string().optional(), companyId: z.string().uuid().optional(), assigneeId: z.string().uuid().optional(), dueDate: z.string().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), serviceType: z.string().optional() }), req.body);
    sendData(res, await saveTask(req.firm!, body), 201);
  } catch (error) {
    next(error);
  }
});
workspaceRouter.patch('/tasks/:id', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ title: z.string().min(2), status: z.enum(['NEW', 'IN_PROGRESS', 'WAITING_DOCUMENTS', 'IN_REVIEW', 'COMPLETED', 'OVERDUE']).optional(), description: z.string().optional(), assigneeId: z.string().uuid().optional(), dueDate: z.string().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional() }), req.body);
    sendData(res, await saveTask(req.firm!, body, param(req, 'id')));
  } catch (error) {
    next(error);
  }
});
workspaceRouter.post('/tasks/:id/comments', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ body: z.string().min(1) }), req.body);
    sendData(res, await commentTask(req.firm!, param(req, 'id'), body.body), 201);
  } catch (error) {
    next(error);
  }
});

const company = Router();
company.use(requireCompany);

company.get('/customers', requirePermission('invoices.read'), async (req, res, next) => {
  try { sendData(res, await partyList(req.company!, 'customer', q(req, 'q'))); } catch (error) { next(error); }
});
company.post('/customers', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await saveParty(req.company!, 'customer', parseBody(partySchema, req.body)), 201); } catch (error) { next(error); }
});
company.patch('/customers/:id', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await saveParty(req.company!, 'customer', parseBody(partySchema, req.body), param(req, 'id'))); } catch (error) { next(error); }
});
company.get('/suppliers', requirePermission('purchases.read'), async (req, res, next) => {
  try { sendData(res, await partyList(req.company!, 'supplier', q(req, 'q'))); } catch (error) { next(error); }
});
company.post('/suppliers', requirePermission('purchases.write'), async (req, res, next) => {
  try { sendData(res, await saveParty(req.company!, 'supplier', parseBody(partySchema, req.body)), 201); } catch (error) { next(error); }
});
company.get('/invoices', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listInvoices(req.company!, { q: q(req, 'q'), status: q(req, 'status'), page: page.page, pageSize: page.pageSize });
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) { next(error); }
});
company.post('/invoices/preview', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await previewInvoice(req.company!, parseBody(invoiceBody.pick({ issueDate: true, currency: true, lines: true }), req.body))); } catch (error) { next(error); }
});
company.post('/invoices', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await createInvoice(req.company!, parseBody(invoiceBody, req.body)), 201); } catch (error) { next(error); }
});
company.get('/invoices/export.xlsx', requirePermission('reports.export'), async (req, res, next) => {
  try {
    const buffer = await workbookFor(req.company!, 'receivables', q(req, 'from'), q(req, 'to'));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) { next(error); }
});
company.get('/invoices/:id', requirePermission('invoices.read'), async (req, res, next) => {
  try { sendData(res, await getInvoice(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.patch('/invoices/:id', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await updateDraft(req.company!, param(req, 'id'), parseBody(invoiceBody, req.body))); } catch (error) { next(error); }
});
company.post('/invoices/:id/finalize', requirePermission('invoices.finalize'), async (req, res, next) => {
  try { sendData(res, await withIdempotency(req, () => finalizeInvoice(req.company!, param(req, 'id'), req.correlationId))); } catch (error) { next(error); }
});
company.post('/invoices/:id/duplicate', requirePermission('invoices.write'), async (req, res, next) => {
  try { sendData(res, await duplicateInvoice(req.company!, param(req, 'id')), 201); } catch (error) { next(error); }
});
company.post('/invoices/:id/credit-notes', requirePermission('invoices.finalize'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ issueDate: z.string(), reason: z.string().min(3), lines: z.array(lineSchema).min(1) }), req.body);
    sendData(res, await createCreditNote(req.company!, param(req, 'id'), body), 201);
  } catch (error) { next(error); }
});
company.get('/invoices/:id/pdf', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const invoice = await getInvoice(req.company!, param(req, 'id'));
    const pdf = await renderInvoicePdf(invoice);
    await writeAudit({ firmId: req.company!.firmId, companyId: req.company!.companyId, userId: req.auth!.userId, action: 'invoice.pdf', entityId: invoice.id, summary: `U shkarkua PDF e faturës ${invoice.displayNumber ?? invoice.id}.`, sensitive: true, correlationId: req.correlationId });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.displayNumber ?? 'fatura'}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
});
company.post('/invoices/:id/email', requirePermission('invoices.finalize'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ to: z.string().email(), message: z.string().optional() }), req.body);
    const invoice = await getInvoice(req.company!, param(req, 'id'));
    const pdf = await renderInvoicePdf(invoice);
    sendData(res, await emailInvoice(req.company!, param(req, 'id'), body, pdf));
  } catch (error) { next(error); }
});
company.get('/purchases', requirePermission('purchases.read'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listPurchases(req.company!, { q: q(req, 'q'), status: q(req, 'status'), page: page.page, pageSize: page.pageSize });
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) { next(error); }
});
company.post('/purchases', requirePermission('purchases.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ supplierId: z.string().uuid().optional(), supplierInvoiceNumber: z.string().optional(), issueDate: z.string(), dueDate: z.string(), currency: z.string().optional(), notes: z.string().optional(), expenseCategoryId: z.string().uuid().optional(), lines: z.array(lineSchema).min(1) }), req.body);
    sendData(res, await createPurchase(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.get('/purchases/:id', requirePermission('purchases.read'), async (req, res, next) => {
  try { sendData(res, await getPurchase(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.post('/purchases/:id/review', requirePermission('purchases.write'), async (req, res, next) => {
  try { sendData(res, await reviewPurchase(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.post('/purchases/:id/post', requirePermission('purchases.post'), async (req, res, next) => {
  try { sendData(res, await postPurchase(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.get('/payments', requirePermission('accounting.read'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listPayments(req.company!, page);
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) { next(error); }
});
company.post('/payments', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ direction: z.enum(['INCOMING', 'OUTGOING']), amount: z.string(), date: z.string(), method: z.enum(['BANK', 'CASH', 'OTHER']), currency: z.string().optional(), bankAccountId: z.string().uuid().optional(), customerId: z.string().uuid().optional(), supplierId: z.string().uuid().optional(), reference: z.string().optional(), notes: z.string().optional(), allocations: z.array(z.object({ invoiceId: z.string().uuid().optional(), purchaseInvoiceId: z.string().uuid().optional(), amount: z.string() })).min(1) }), req.body);
    sendData(res, await withIdempotency(req, () => createPayment(req.company!, body)), 201);
  } catch (error) { next(error); }
});
company.post('/payments/:id/reverse', requirePermission('payments.reverse'), async (req, res, next) => {
  try { sendData(res, await reversePayment(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.get('/accounts', requirePermission('accounting.read'), async (req, res, next) => {
  try { sendData(res, await listAccounts(req.company!)); } catch (error) { next(error); }
});
company.post('/accounts', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ code: z.string().min(2), name: z.string().min(2), type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']), normalBalance: z.enum(['DEBIT', 'CREDIT']) }), req.body);
    sendData(res, await createAccount(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.get('/journal-entries', requirePermission('accounting.read'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listJournals(req.company!, page.page, page.pageSize);
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) { next(error); }
});
company.post('/journal-entries', requirePermission('accounting.post'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ date: z.string(), description: z.string().min(2), lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.string(), credit: z.string(), description: z.string().optional() })).min(2) }), req.body);
    sendData(res, await createDraftJournal(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.post('/journal-entries/:id/post', requirePermission('accounting.post'), async (req, res, next) => {
  try { sendData(res, await postDraftJournal(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.post('/journal-entries/:id/reverse', requirePermission('accounting.post'), async (req, res, next) => {
  try { sendData(res, await reverseJournal(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.get('/periods', requirePermission('accounting.read'), async (req, res, next) => {
  try { sendData(res, await listPeriods(req.company!)); } catch (error) { next(error); }
});
company.post('/periods/:id/close', requirePermission('accounting.close'), async (req, res, next) => {
  try { sendData(res, await setPeriod(req.company!, param(req, 'id'), 'close')); } catch (error) { next(error); }
});
company.post('/periods/:id/reopen', requirePermission('accounting.close'), async (req, res, next) => {
  try { sendData(res, await setPeriod(req.company!, param(req, 'id'), 'reopen')); } catch (error) { next(error); }
});
company.get('/tax-rates', requirePermission('tax.read'), async (req, res, next) => {
  try { sendData(res, await prisma.taxRate.findMany({ where: { companyId: req.company!.companyId, firmId: req.firm!.firmId }, orderBy: { code: 'asc' } })); } catch (error) { next(error); }
});
company.post('/tax-rates/:id/confirm', requirePermission('tax.review'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ note: z.string().min(8) }), req.body);
    sendData(res, await confirmTaxRate(req.company!, param(req, 'id'), body.note));
  } catch (error) { next(error); }
});
company.get('/tax/summary', requirePermission('tax.read'), async (req, res, next) => {
  try { sendData(res, await buildReport(req.company!, 'vat', q(req, 'from'), q(req, 'to'))); } catch (error) { next(error); }
});
company.get('/tax-reports', requirePermission('tax.read'), async (req, res, next) => {
  try { sendData(res, await prisma.taxReport.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});
company.post('/tax-reports', requirePermission('tax.review'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ from: z.string(), to: z.string() }), req.body);
    sendData(res, await createTaxReport(req.company!, body.from, body.to), 201);
  } catch (error) { next(error); }
});
company.post('/tax-reports/:id/review', requirePermission('tax.review'), async (req, res, next) => {
  try { sendData(res, await reviewTaxReport(req.company!, param(req, 'id'), req.body?.notes)); } catch (error) { next(error); }
});
company.post('/tax-reports/:id/mark-external', requirePermission('tax.review'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ note: z.string().min(8) }), req.body);
    sendData(res, await markTaxExternal(req.company!, param(req, 'id'), body.note));
  } catch (error) { next(error); }
});
company.get('/aging', requirePermission('reports.read'), async (req, res, next) => {
  try { sendData(res, await agingReport(req.company!, q(req, 'asOf'))); } catch (error) { next(error); }
});
company.get('/month-checklist', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const year = Number(q(req, 'year') ?? new Date().getFullYear());
    const month = Number(q(req, 'month') ?? new Date().getMonth() + 1);
    sendData(res, await ensureMonthChecklist(req.company!, year, month));
  } catch (error) { next(error); }
});
company.patch('/month-checklist/items/:id', requirePermission('tasks.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE']).optional(), comment: z.string().max(1000).optional() }), req.body);
    sendData(res, await updateMonthItem(req.company!, param(req, 'id'), body));
  } catch (error) { next(error); }
});
company.get('/bank-workspace', requirePermission('accounting.read'), async (req, res, next) => {
  try { sendData(res, await bankWorkspace(req.company!)); } catch (error) { next(error); }
});
company.post('/bank-transactions/:id/match', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ invoiceId: z.string().uuid(), confirm: z.literal(true) }), req.body);
    sendData(res, await confirmBankMatch(req.company!, param(req, 'id'), body.invoiceId));
  } catch (error) { next(error); }
});
company.get('/reports/:type', requirePermission('reports.read'), async (req, res, next) => {
  try { sendData(res, await buildReport(req.company!, param(req, 'type'), q(req, 'from'), q(req, 'to'))); } catch (error) { next(error); }
});
company.get('/reports/:type/export.xlsx', requirePermission('reports.export'), async (req, res, next) => {
  try {
    const buffer = await workbookFor(req.company!, param(req, 'type'), q(req, 'from'), q(req, 'to'));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) { next(error); }
});
company.get('/reports/:type/export.csv', requirePermission('reports.export'), async (req, res, next) => {
  try {
    const report = await buildReport(req.company!, param(req, 'type'), q(req, 'from'), q(req, 'to'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csvFor(report as unknown as Record<string, unknown>));
  } catch (error) { next(error); }
});
company.get('/documents', requirePermission('documents.read'), async (req, res, next) => {
  try { sendData(res, await prisma.document.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId }, orderBy: { createdAt: 'desc' }, take: 100 })); } catch (error) { next(error); }
});
company.post('/documents', requirePermission('documents.write'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('BAD_REQUEST', 400, 'Mungon skedari.');
    const stored = await storePrivateFile(req.firm!.firmId, req.company!.companyId, req.file);
    sendData(res, await saveDocument(req.company!, stored, { category: String(req.body.category || 'OTHER'), periodMonth: numberOrUndefined(req.body.periodMonth), periodYear: numberOrUndefined(req.body.periodYear), notes: req.body.notes, purchaseInvoiceId: req.body.purchaseInvoiceId, sharedWithClient: req.body.sharedWithClient === 'true' }), 201);
  } catch (error) { next(error); }
});
company.get('/documents/:id/file', requirePermission('documents.read'), async (req, res, next) => {
  try {
    const document = await getOwnedDocument(req.company!, param(req, 'id'));
    const file = openPrivateFile(document.storedName);
    await writeAudit({ firmId: req.firm!.firmId, companyId: req.company!.companyId, userId: req.auth!.userId, action: 'document.download', entityId: document.id, summary: 'U shkarkua një dokument.', sensitive: true });
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${document.originalName.replace(/[^\w.\- ()ëçËÇ]/g, '_')}"`);
    file.stream.pipe(res);
  } catch (error) { next(error); }
});
company.patch('/documents/:id', requirePermission('documents.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ status: z.enum(['RECEIVED', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION', 'PROCESSED']).optional(), notes: z.string().optional(), sharedWithClient: z.boolean().optional() }), req.body);
    sendData(res, await updateDocument(req.company!, param(req, 'id'), body));
  } catch (error) { next(error); }
});
company.post('/document-requests', requirePermission('documents.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ category: z.string(), periodMonth: z.number().optional(), periodYear: z.number().optional(), message: z.string().min(2), dueDate: z.string().optional() }), req.body);
    sendData(res, await requestDocument(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.get('/bank-accounts', requirePermission('accounting.read'), async (req, res, next) => {
  try { sendData(res, await prisma.bankAccount.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId } })); } catch (error) { next(error); }
});
company.post('/bank-accounts', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ name: z.string().min(2), iban: z.string().optional(), bankName: z.string().optional(), currency: z.string().default('EUR'), isCash: z.boolean().optional() }), req.body);
    sendData(res, await prisma.bankAccount.create({ data: { ...body, firmId: req.firm!.firmId, companyId: req.company!.companyId, connected: false } }), 201);
  } catch (error) { next(error); }
});
company.post('/bank-accounts/:id/import', requirePermission('accounting.post'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ csv: z.string().min(3) }), req.body);
    sendData(res, await importBankStatement(req.company!, param(req, 'id'), body.csv));
  } catch (error) { next(error); }
});
company.post('/exchange-rates', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ quoteCurrency: z.string().length(3), rate: z.string(), effectiveOn: z.string() }), req.body);
    sendData(res, await prisma.exchangeRate.create({ data: { firmId: req.firm!.firmId, companyId: req.company!.companyId, quoteCurrency: body.quoteCurrency.toUpperCase(), rate: body.rate, effectiveOn: new Date(`${body.effectiveOn}T00:00:00.000Z`), source: 'MANUAL', createdById: req.auth!.userId } }), 201);
  } catch (error) { next(error); }
});
company.post('/imports/customers', requirePermission('companies.update'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ fileName: z.string(), csv: z.string().min(3) }), req.body);
    sendData(res, await importCustomers(req.company!, body.fileName, body.csv, req.auth!.userId), 201);
  } catch (error) { next(error); }
});
company.post('/imports/:id/commit', requirePermission('companies.update'), async (req, res, next) => {
  try { sendData(res, await commitImport(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});
company.get('/employees', requirePermission('payroll.read'), async (req, res, next) => {
  try { sendData(res, await prisma.employee.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId }, orderBy: { lastName: 'asc' } })); } catch (error) { next(error); }
});
company.post('/employees', requirePermission('payroll.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ firstName: z.string(), lastName: z.string(), personalNumber: z.string().optional(), jobTitle: z.string().optional(), grossSalary: z.string(), hiredOn: z.string().optional() }), req.body);
    sendData(res, await prisma.employee.create({ data: { ...body, hiredOn: body.hiredOn ? new Date(`${body.hiredOn}T00:00:00.000Z`) : undefined, firmId: req.firm!.firmId, companyId: req.company!.companyId } }), 201);
  } catch (error) { next(error); }
});
company.post('/payroll-rules', requirePermission('payroll.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ name: z.string(), effectiveFrom: z.string(), pensionEmployeePercent: z.string(), pensionEmployerPercent: z.string(), taxBase: z.enum(['GROSS', 'GROSS_MINUS_EMPLOYEE_PENSION']), brackets: z.array(z.object({ upTo: z.string().nullable(), ratePercent: z.string() })), sourceNote: z.string().min(8) }), req.body);
    sendData(res, await savePayrollRule(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.post('/payroll-rules/:id/confirm', requirePermission('payroll.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ note: z.string().min(8) }), req.body);
    sendData(res, await confirmPayrollRule(req.company!, param(req, 'id'), body.note));
  } catch (error) { next(error); }
});
company.post('/payroll-runs', requirePermission('payroll.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ ruleSetId: z.string().uuid(), periodStart: z.string(), periodEnd: z.string() }), req.body);
    sendData(res, await runPayroll(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.get('/assets', requirePermission('accounting.read'), async (req, res, next) => {
  try { sendData(res, await prisma.fixedAsset.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId } })); } catch (error) { next(error); }
});
company.post('/assets', requirePermission('accounting.post'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ name: z.string(), acquiredOn: z.string(), acquisitionCost: z.string(), residualValue: z.string().optional(), usefulLifeMonths: z.number().int().positive(), policyNote: z.string().min(3) }), req.body);
    sendData(res, await saveAsset(req.company!, body), 201);
  } catch (error) { next(error); }
});
company.post('/assets/:id/depreciate', requirePermission('accounting.post'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ periodStart: z.string(), periodEnd: z.string() }), req.body);
    sendData(res, await depreciateAsset(req.company!, param(req, 'id'), body.periodStart, body.periodEnd), 201);
  } catch (error) { next(error); }
});
company.get('/products', requirePermission('invoices.read'), async (req, res, next) => {
  try { sendData(res, await prisma.product.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId, isActive: true } })); } catch (error) { next(error); }
});
company.post('/products', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ name: z.string(), sku: z.string().optional(), type: z.enum(['PRODUCT', 'SERVICE']).optional(), unit: z.string().optional(), unitPrice: z.string(), vatPercent: z.string().optional(), trackInventory: z.boolean().optional() }), req.body);
    sendData(res, await prisma.product.create({ data: { name: body.name, sku: body.sku, type: body.type, unit: body.unit, unitPrice: body.unitPrice, vatPercent: body.vatPercent ?? '0', trackInventory: body.trackInventory ?? false, firmId: req.firm!.firmId, companyId: req.company!.companyId } }), 201);
  } catch (error) { next(error); }
});
company.post('/support', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ subject: z.string().min(3), body: z.string().min(3) }), req.body);
    sendData(res, await prisma.supportRequest.create({ data: { firmId: req.firm!.firmId, userId: req.auth!.userId, subject: body.subject, body: body.body } }), 201);
  } catch (error) { next(error); }
});
company.use('/fiscal', fiscalRouter);

company.get('/activity', async (req, res, next) => {
  try {
    sendData(res, await prisma.auditLog.findMany({ where: { firmId: req.firm!.firmId, companyId: req.company!.companyId }, orderBy: { createdAt: 'desc' }, take: 50 }));
  } catch (error) { next(error); }
});

workspaceRouter.use(company);

const partySchema = z.object({
  name: z.string().min(2),
  fiscalNumber: z.string().optional(),
  vatNumber: z.string().optional(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

async function assertPortal(userId: string, companyId: string) {
  const membership = await prisma.companyMembership.findFirst({ where: { userId, companyId, status: 'ACTIVE' } });
  if (!membership) throw new AppError('NOT_FOUND', 404, 'Kompania nuk u gjet.');
  return membership;
}

function q(req: { query: Record<string, unknown> }, key: string) {
  const value = req.query[key];
  return typeof value === 'string' && value ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function withIdempotency(req: { get(name: string): string | undefined; firm?: { firmId: string }; body: unknown }, work: () => Promise<unknown>) {
  const key = req.get('idempotency-key');
  if (!key || !req.firm) return work();
  const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
  const existing = await prisma.idempotencyKey.findUnique({ where: { firmId_key: { firmId: req.firm.firmId, key } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 409, 'Çelësi i idempotencës është përdorur për një kërkesë tjetër.');
    return existing.responseBody;
  }
  const body = serialize(await work());
  try {
    await prisma.idempotencyKey.create({ data: { firmId: req.firm.firmId, key, requestHash, statusCode: 200, responseBody: body as Prisma.InputJsonValue } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await prisma.idempotencyKey.findUnique({ where: { firmId_key: { firmId: req.firm.firmId, key } } });
      if (again) return again.responseBody;
    }
    throw error;
  }
  return body;
}

function param(req: { params: Record<string, unknown> }, key: string) {
  const value = req.params[key];
  const id = Array.isArray(value) ? value[0] : value;
  if (typeof id !== 'string' || !id) throw new AppError('BAD_REQUEST', 400, 'Identifikuesi mungon.');
  return id;
}
