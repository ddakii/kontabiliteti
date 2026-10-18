import { Router } from 'express';
import { z } from 'zod';
import { pageParams, sendData, sendPage } from '../lib/http';
import { AppError } from '../lib/errors';
import { rateLimit, requirePermission, parseBody } from '../middleware/security';
import {
  addFiscalBranch,
  addFiscalPos,
  adjustFiscalReceipt,
  checkFiscalConnection,
  fiscalInvoices,
  fiscalOverview,
  fiscalReceiptPdf,
  getFiscalReceipt,
  listFiscalReceipts,
  markFiscalUnknown,
  onboardFiscalPos,
  saveFiscalSettings,
  submitFiscalInvoice,
} from '../services/fiscal';

export const fiscalRouter = Router();
const limited = rateLimit(30, 60_000, 'fiscal');

fiscalRouter.get('/', requirePermission('fiscal.read'), async (req, res, next) => {
  try { sendData(res, await fiscalOverview(req.company!)); } catch (error) { next(error); }
});

fiscalRouter.put('/settings', limited, requirePermission('fiscal.configure'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      nui: z.string().regex(/^\d{5,18}$/),
      fiscalizationNo: z.string().max(64).optional(),
      applicationId: z.string().regex(/^[1-9]\d{0,17}$/),
      defaultUnit: z.string().min(1).max(20),
      itemType: z.string().min(1).max(20),
      environment: z.enum(['TEST', 'PRODUCTION']),
      confirmProduction: z.boolean().optional(),
    }), req.body);
    sendData(res, await saveFiscalSettings(req.company!, body));
  } catch (error) { next(error); }
});

fiscalRouter.post('/branches', limited, requirePermission('fiscal.configure'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      branchNumber: z.string().regex(/^[1-9]\d{0,17}$/),
      location: z.string().min(1).max(80),
    }), req.body);
    sendData(res, await addFiscalBranch(req.company!, body), 201);
  } catch (error) { next(error); }
});

fiscalRouter.post('/terminals', limited, requirePermission('fiscal.configure'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      branchId: z.string().uuid(),
      posNumber: z.string().regex(/^[1-9]\d{0,17}$/),
    }), req.body);
    sendData(res, await addFiscalPos(req.company!, body), 201);
  } catch (error) { next(error); }
});

fiscalRouter.post('/terminals/:id/onboard', limited, requirePermission('fiscal.configure'), async (req, res, next) => {
  try { sendData(res, await onboardFiscalPos(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});

fiscalRouter.post('/check', limited, requirePermission('fiscal.configure'), async (req, res, next) => {
  try { sendData(res, await checkFiscalConnection(req.company!)); } catch (error) { next(error); }
});

fiscalRouter.get('/invoices', requirePermission('fiscal.read'), async (req, res, next) => {
  try { sendData(res, await fiscalInvoices(req.company!)); } catch (error) { next(error); }
});

fiscalRouter.get('/receipts', requirePermission('fiscal.read'), async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const result = await listFiscalReceipts(req.company!, {
      q: q(req, 'q'),
      status: q(req, 'status'),
      page: page.page,
      pageSize: page.pageSize,
    });
    sendPage(res, result.rows, { page: page.page, pageSize: page.pageSize, total: result.total });
  } catch (error) { next(error); }
});

fiscalRouter.get('/receipts/:id', requirePermission('fiscal.read'), async (req, res, next) => {
  try { sendData(res, await getFiscalReceipt(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});

fiscalRouter.get('/receipts/:id/pdf', requirePermission('fiscal.read'), async (req, res, next) => {
  try {
    const pdf = await fiscalReceiptPdf(req.company!, param(req, 'id'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="kupon-fiskal.pdf"');
    res.send(pdf);
  } catch (error) { next(error); }
});

fiscalRouter.post('/invoices/:invoiceId/submit', limited, requirePermission('fiscal.submit'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      posId: z.string().uuid(),
      paymentKind: z.enum(['CASH', 'CREDIT_CARD', 'VOUCHER', 'CHEQUE', 'CRYPTO', 'OTHER']),
    }), req.body);
    sendData(res, await submitFiscalInvoice(req.company!, param(req, 'invoiceId'), body));
  } catch (error) { next(error); }
});

fiscalRouter.post('/receipts/:id/adjust', limited, requirePermission('fiscal.submit'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      kind: z.enum(['CANCEL', 'RETURN']),
      reason: z.string().min(3).max(500),
    }), req.body);
    sendData(res, await adjustFiscalReceipt(req.company!, param(req, 'id'), body));
  } catch (error) { next(error); }
});

fiscalRouter.post('/receipts/:id/unknown', limited, requirePermission('fiscal.submit'), async (req, res, next) => {
  try { sendData(res, await markFiscalUnknown(req.company!, param(req, 'id'))); } catch (error) { next(error); }
});

function q(req: { query: Record<string, unknown> }, key: string) {
  const value = req.query[key];
  return typeof value === 'string' && value ? value : undefined;
}

function param(req: { params: Record<string, unknown> }, key: string) {
  const value = req.params[key];
  const id = Array.isArray(value) ? value[0] : value;
  if (typeof id !== 'string' || !id) throw new AppError('BAD_REQUEST', 400, 'Identifikuesi mungon.');
  return id;
}
