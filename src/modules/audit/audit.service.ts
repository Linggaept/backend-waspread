import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from '../../database/entities/audit-log.entity';

export interface AuditLogData {
  userId?: string;
  action: AuditAction;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Log an action asynchronously (fire-and-forget)
   * This ensures the main request is not blocked by audit logging
   */
  log(data: AuditLogData): void {
    // Fire-and-forget: don't await, don't block the main request
    this.saveLog(data).catch((error) => {
      this.logger.error('Failed to save audit log:', error);
    });
  }

  /**
   * Log an action and wait for it to complete
   * Use this when you need to ensure the log is saved before proceeding
   */
  async logSync(data: AuditLogData): Promise<AuditLog> {
    return this.saveLog(data);
  }

  private async saveLog(data: AuditLogData): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      userId: data.userId,
      action: data.action,
      ip: data.ip,
      userAgent: data.userAgent,
      metadata: data.metadata,
    });

    return this.auditLogRepository.save(auditLog);
  }

  /**
   * Get audit logs for a specific user
   */
  async findByUser(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: AuditLog[]; total: number }> {
    const [data, total] = await this.auditLogRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });

    return { data, total };
  }

  /**
   * Get recent audit logs (for admin dashboard)
   */
  async findRecent(limit: number = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Cleanup old audit logs (call this via cron job)
   */
  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(`Cleaned up ${result.affected} old audit logs`);
    return result.affected || 0;
  }
}
