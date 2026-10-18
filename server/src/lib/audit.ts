import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

type AuditInput = {
  firmId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
  sensitive?: boolean;
  ip?: string | null;
  correlationId?: string | null;
};

export async function writeAudit(input: AuditInput, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await tx.auditLog.create({
    data: {
      firmId: input.firmId ?? null,
      companyId: input.companyId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata,
      sensitive: input.sensitive ?? false,
      ip: input.ip ?? null,
      correlationId: input.correlationId ?? null,
    },
  });
}
