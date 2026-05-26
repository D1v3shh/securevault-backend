import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLogEntity, AuditLogDocument } from './schemas/audit-log.schema';
import { AuditEventData } from './interfaces/audit.interface';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLogEntity.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Record an audit event.
   */
  async log(event: AuditEventData): Promise<void> {
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
    } catch (error: any) {
      // Audit logging should never crash the application
      this.logger.error(`Failed to write audit log: ${error.message}`);
    }
  }

  /**
   * Query audit logs with pagination and filters.
   */
  async findAll(
    query: PaginationDto & {
      action?: string;
      userId?: string;
      resource?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<PaginatedResponse<AuditLogDocument>> {
    const { page = 1, limit = 20, action, userId, resource, startDate, endDate } = query;
    const filter: any = {};

    if (action) filter.action = { $regex: action, $options: 'i' };
    if (userId) filter.userId = userId;
    if (resource) filter.resource = resource;
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = startDate;
      if (endDate) filter.timestamp.$lte = endDate;
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.auditLogModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: { total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    };
  }
}
