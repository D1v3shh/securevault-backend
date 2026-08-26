import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileProcessor } from './processors/file.processor';
import { FileEntity, FileSchema } from '../files/schemas/file.schema';
import { StorageModule } from '../storage/storage.module';

/**
 * Queue module for background file maintenance.
 *
 * There is no queue or scheduler wired up: `bullmq` is installed but
 * `@nestjs/bull` is declared and not installed, `@nestjs/schedule` is absent,
 * and RedisModule's client sets `keyPrefix`, which BullMQ forbids on its
 * connection. FileProcessor is therefore invoked by
 * `scripts/cleanup-expired-files.ts` rather than by a worker. See the technical
 * debt section of PROJECT_CONTEXT.md before adding BullMQ.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: FileEntity.name, schema: FileSchema }]),
    StorageModule,
  ],
  providers: [FileProcessor],
  exports: [FileProcessor],
})
export class QueueModule {}
