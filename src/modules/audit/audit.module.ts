import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditService } from './audit.service';
import { AuditLogEntity, AuditLogSchema } from './schemas/audit-log.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLogEntity.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
