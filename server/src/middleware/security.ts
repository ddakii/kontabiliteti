import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { config } from '../config';
import { AppError, forbidden, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { sha256 } from '../lib/tokens';
import { WRITE_PERMISSIONS, type PermissionKey } from '../lib/access';
import type { AuthUser, CompanyActor, FirmActor } from '../types/express';

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(limit: number, windowMs: number, name: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      next(new AppError('RATE_LIMITED', 429, 'Shumë përpjekje. Provoni përsëri më vonë.'));
      return;
    }
    next();
  };
}

export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  if (req.get('x-kontabiliteti-request') !== '1') {
    next(new AppError('CSRF_REJECTED', 403, 'Kërkesa u refuzua.'));
    return;
  }
  next();
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 422, 'Të dhënat nuk janë të vlefshme.', issues(result.error));
  }
  return result.data;
}

function issues(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[config.sessionCookie];
    if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Duhet të hyni në llogari.');
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw new AppError('UNAUTHENTICATED', 401, 'Sesioni nuk është i vlefshëm.');
    }
    const auth: AuthUser = {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isPlatformAdmin: session.user.isPlatformAdmin,
      emailVerified: Boolean(session.user.emailVerifiedAt),
      sessionId: session.id,
    };
    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireFirm(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new AppError('UNAUTHENTICATED', 401, 'Duhet të hyni në llogari.');
    const firmId = req.get('x-firm-id');
    if (!firmId) throw new AppError('FIRM_REQUIRED', 400, 'Zgjidhni zyrën e kontabilitetit.');
    const membership = await prisma.firmMembership.findFirst({
      where: { firmId, userId: req.auth.userId, status: 'ACTIVE' },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        overrides: true,
        firm: { include: { subscription: true } },
      },
    });
    if (!membership || membership.firm.status === 'CLOSED') throw notFound('Zyra nuk u gjet.');
    if (membership.firm.status === 'SUSPENDED') {
      throw new AppError('FIRM_SUSPENDED', 403, 'Zyra është e pezulluar nga platforma.');
    }
    const permissions = new Set(membership.role.permissions.map((item) => item.permission.key));
    for (const override of membership.overrides) {
      if (override.effect === 'DENY') permissions.delete(override.permissionKey);
      else permissions.add(override.permissionKey);
    }
    const subscription = membership.firm.subscription;
    const readOnly =
      !subscription ||
      subscription.readOnly ||
      subscription.status === 'EXPIRED' ||
      subscription.status === 'SUSPENDED' ||
      subscription.status === 'CANCELLED';
    const firm: FirmActor = {
      ...req.auth,
      firmId,
      membershipId: membership.id,
      roleKey: membership.role.key,
      accessScope: membership.role.accessScope,
      permissions,
      readOnly,
    };
    req.firm = firm;
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(permission: PermissionKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.firm?.permissions.has(permission)) {
      next(forbidden());
      return;
    }
    if (req.firm.readOnly && WRITE_PERMISSIONS.has(permission)) {
      next(
        new AppError(
          'SUBSCRIPTION_READONLY',
          403,
          'Abonimi është në gjendje vetëm për lexim. Regjistrimet ekzistuese mbeten të ruajtura.',
        ),
      );
      return;
    }
    next();
  };
}

export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.emailVerified) {
    next(new AppError('EMAIL_UNVERIFIED', 403, 'Verifikoni emailin para se të vazhdoni.'));
    return;
  }
  next();
}

export async function requireCompany(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.firm) throw new AppError('FIRM_REQUIRED', 400, 'Zgjidhni zyrën e kontabilitetit.');
    const companyId = req.get('x-company-id') || req.params.companyId;
    if (!companyId || Array.isArray(companyId)) {
      throw new AppError('COMPANY_REQUIRED', 400, 'Zgjidhni kompaninë kliente.');
    }
    const company = await prisma.clientCompany.findFirst({ where: { id: companyId, firmId: req.firm.firmId } });
    if (!company) throw notFound('Kompania nuk u gjet.');
    if (req.firm.accessScope !== 'ALL_COMPANIES') {
      const assignment = await prisma.companyAssignment.findFirst({
        where: { companyId, firmId: req.firm.firmId, userId: req.firm.userId },
      });
      if (!assignment) throw notFound('Kompania nuk u gjet.');
    }
    const actor: CompanyActor = { ...req.firm, companyId: company.id };
    req.company = actor;
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.isPlatformAdmin) {
    next(forbidden('Kjo zonë është vetëm për administratorin e platformës.'));
    return;
  }
  next();
}

export async function companyIdsFor(actor: FirmActor): Promise<string[] | 'ALL'> {
  if (actor.accessScope === 'ALL_COMPANIES') return 'ALL';
  const rows = await prisma.companyAssignment.findMany({
    where: { firmId: actor.firmId, userId: actor.userId },
    select: { companyId: true },
  });
  return rows.map((row) => row.companyId);
}
