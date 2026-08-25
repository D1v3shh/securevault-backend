import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { FileEntity, FileSchema } from './schemas/file.schema';
import { EncryptionModule } from '../encryption/encryption.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { SharesModule } from '../shares/shares.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FileEntity.name, schema: FileSchema }]),
    MulterModule.register({
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
    }),
    EncryptionModule,
    StorageModule,
    AuditModule,
    // Provides FileAccessValidationService — the shared-access authorization
    // gate consulted by FilesService for non-owner, non-admin requesters.
    SharesModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
