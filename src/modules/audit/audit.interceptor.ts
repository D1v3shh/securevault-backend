import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditAction } from './interfaces/audit.interface';

/**
 * Audit interceptor that automatically logs API requests.
 * Can be applied globally or per-controller.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, user } = request;
    const userAgent = request.get('user-agent') || '';

    // Only audit state-changing operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const resource = this.extractResource(url);
          this.auditService.log({
            action: `${method.toLowerCase()}.${resource}`,
            resource,
            userId: user?.userId,
            userEmail: user?.email,
            userRole: user?.role,
            ipAddress: ip,
            userAgent,
            metadata: { method, url, duration: Date.now() - startTime },
            status: 'success',
          }).catch(() => {}); // Fire and forget
        },
        error: (error) => {
          const resource = this.extractResource(url);
          this.auditService.log({
            action: `${method.toLowerCase()}.${resource}`,
            resource,
            userId: user?.userId,
            userEmail: user?.email,
            userRole: user?.role,
            ipAddress: ip,
            userAgent,
            metadata: { method, url, error: error.message, duration: Date.now() - startTime },
            status: 'failure',
          }).catch(() => {});
        },
      }),
    );
  }

  private extractResource(url: string): string {
    const parts = url.split('/').filter(Boolean);
    // Remove api version prefix (e.g., api/v1)
    const startIdx = parts.findIndex((p) => p === 'v1' || p === 'v2');
    return parts.slice(startIdx + 1, startIdx + 2).join('.') || 'unknown';
  }
}
