import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { pageParams, sendData, sendPage } from '../lib/http';
import { prisma } from '../lib/prisma';
import { parseBody, requireAuth, requirePlatformAdmin } from '../middleware/security';
import {
  activateSubscription,
  grantedCompanyProfile,
  listFirms,
  platformMetrics,
  recordBillingPayment,
  setFirmStatus,
  supportGrant,
  updatePlan,
} from '../services/platform';

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformAdmin);

platformRouter.get('/metrics', async (_req, res, next) => {
  try {
    sendData(res, await platformMetrics());
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/firms', async (_req, res, next) => {
  try {
    sendData(res, await listFirms());
  } catch (error) {
    next(error);
  }
});

platformRouter.post('/firms/:id/suspend', async (req, res, next) => {
  try {
    sendData(res, await setFirmStatus(param(req, 'id'), 'SUSPENDED', req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

platformRouter.post('/firms/:id/reactivate', async (req, res, next) => {
  try {
    sendData(res, await setFirmStatus(param(req, 'id'), 'ACTIVE', req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/plans', async (_req, res, next) => {
  try {
    sendData(res, await prisma.subscriptionPlan.findMany({ include: { entitlements: true }, orderBy: { sortOrder: 'asc' } }));
  } catch (error) {
    next(error);
  }
});

platformRouter.patch('/plans/:id', async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        monthlyPrice: z.string().nullable().optional(),
        annualPrice: z.string().nullable().optional(),
        maxCompanies: z.number().int().nullable().optional(),
        maxMembers: z.number().int().nullable().optional(),
        isActive: z.boolean().optional(),
        entitlements: z.array(z.object({ featureKey: z.string(), enabled: z.boolean() })).optional(),
      }),
      req.body,
    );
    sendData(res, await updatePlan(param(req, 'id'), body));
  } catch (error) {
    next(error);
  }
});

platformRouter.post('/firms/:id/activate-subscription', async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({
        planCode: z.string(),
        interval: z.enum(['MONTHLY', 'ANNUAL']),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().min(8),
      }),
      req.body,
    );
    sendData(res, await activateSubscription(req.auth!.userId, param(req, 'id'), body));
  } catch (error) {
    next(error);
  }
});

platformRouter.post('/billing-invoices/:id/payments', async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({
        amount: z.string(),
        reference: z.string().min(2),
        receivedAt: z.string(),
        note: z.string().min(3),
        confirm: z.literal(true),
      }),
      req.body,
    );
    sendData(res, await recordBillingPayment(req.auth!.userId, param(req, 'id'), body), 201);
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/jobs', async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const where = req.query.status ? { status: String(req.query.status) as 'FAILED' } : {};
    const [total, rows] = await prisma.$transaction([
      prisma.backgroundJob.count({ where }),
      prisma.backgroundJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
    ]);
    sendPage(res, rows, { page: page.page, pageSize: page.pageSize, total });
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/audit', async (req, res, next) => {
  try {
    const page = pageParams(req.query as Record<string, unknown>);
    const where = { sensitive: false };
    const [total, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
    ]);
    sendPage(res, rows, { page: page.page, pageSize: page.pageSize, total });
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/support', async (_req, res, next) => {
  try {
    sendData(res, await prisma.supportRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { firm: { select: { legalName: true } } } }));
  } catch (error) {
    next(error);
  }
});

platformRouter.post('/support-grants', async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({
        firmId: z.string().uuid(),
        companyId: z.string().uuid().optional(),
        grantedToUserId: z.string().uuid(),
        reason: z.string().min(8),
        hours: z.number().int().min(1).max(72),
      }),
      req.body,
    );
    sendData(res, await supportGrant(req.auth!.userId, body), 201);
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/companies/:id/profile', async (req, res, next) => {
  try {
    sendData(res, await grantedCompanyProfile(req.auth!.userId, param(req, 'id')));
  } catch (error) {
    next(error);
  }
});

platformRouter.get('/settings', async (_req, res, next) => {
  try {
    const settings = await prisma.platformSetting.findMany();
    const smtpConfigured = Boolean(process.env.SMTP_HOST);
    sendData(res, { settings, smtpConfigured, ocrConfigured: false, bankConnectionsConfigured: false });
  } catch (error) {
    next(error);
  }
});

platformRouter.patch('/settings/:key', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }), req.body);
    sendData(res, await prisma.platformSetting.upsert({ where: { key: param(req, 'key') }, update: { value: body.value }, create: { key: param(req, 'key'), value: body.value } }));
  } catch (error) {
    next(error);
  }
});

function param(req: { params: Record<string, unknown> }, key: string) {
  const value = req.params[key];
  const id = Array.isArray(value) ? value[0] : value;
  if (typeof id !== 'string' || !id) throw new AppError('BAD_REQUEST', 400, 'Identifikuesi mungon.');
  return id;
}
