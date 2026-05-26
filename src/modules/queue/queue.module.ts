import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditProcessor } from './processors/audit.processor';
import { FileProcessor } from './processors/file.processor';
import { AuditLogEntity, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { FileEntity, FileSchema } from '../files/schemas/file.schema';
import { StorageModule } from '../storage/storage.module';

/**
 * Queue module for asynchronous background task processing.
 *
 * Currently implements direct async processing. When BullMQ integration
 * is needed, simply:
 * 1. Add BullModule.forRootAsync() with Redis config
 * 2. Add BullModule.registerQueue() for each queue
 * 3. Convert processors to BullMQ @Processor() decorated classes
 * 4. The existing processor logic remains unchanged
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLogEntity.name, schema: AuditLogSchema },
      { name: FileEntity.name, schema: FileSchema },
    ]),
    StorageModule,
  ],
  providers: [
    AuditProcessor,
    FileProcessor,
  ],
  exports: [
    AuditProcessor,
    FileProcessor,
  ],
})
export class QueueModule {}
