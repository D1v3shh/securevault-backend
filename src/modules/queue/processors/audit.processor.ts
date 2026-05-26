import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLogEntity, AuditLogDocument } from '../../audit/schemas/audit-log.schema';
import type { AuditEventData } from '../../audit/interfaces/audit.interface';

/**
 * Audit processor for handling asynchronous audit log writes.
 *
 * In production, this would be a BullMQ worker processing jobs
 * from the audit queue. For now, it provides a direct async write
 * implementation that can be swapped to queue-based processing
 * without changing the interface.
 */
@Injectable()
export class AuditProcessor {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(
    @InjectModel(AuditLogEntity.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Process an audit log event — write it to the database.
   * In queue-based mode, this would be invoked by a BullMQ worker.
   */
  async processAuditEvent(event: AuditEventData): Promise<void> {
    try {
      await this.auditLogModel.create({
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId || null,
        userId: event.userId || null,
        userEmail: event.userEmail || null,
        userRole: event.userRole || null,
        ipAddress: event.ipAddress || null,
        userAgent: event.userAgent || null,
        metadata: event.metadata || {},
        status: event.status || 'success',
        timestamp: new Date(),
      });

      this.logger.debug(`Audit event processed: ${event.action}`);
    } catch (error: any) {
      this.logger.error(`Failed to process audit event: ${error.message}`);
      // In production, this would trigger a DLQ (dead letter queue) retry
    }
  }

  /**
   * Batch process multiple audit events.
   * Useful for high-throughput scenarios.
   */
  async processBatch(events: AuditEventData[]): Promise<void> {
    try {
      const documents = events.map((event) => ({
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId || null,
        userId: event.userId || null,
        userEmail: event.userEmail || null,
        userRole: event.userRole || null,
        ipAddress: event.ipAddress || null,
        userAgent: event.userAgent || null,
        metadata: event.metadata || {},
        status: event.status || 'success',
        timestamp: new Date(),
      }));

      await this.auditLogModel.insertMany(documents, { ordered: false });
      this.logger.debug(`Batch audit events processed: ${events.length} events`);
    } catch (error: any) {
      this.logger.error(`Failed to process audit batch: ${error.message}`);
    }
  }
}
