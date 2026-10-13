import { prisma } from '../config/prisma';
import { logger } from './logger';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export const recordAudit = async (entry: AuditEntry): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata as object | undefined,
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log', { error, action: entry.action });
  }
};
