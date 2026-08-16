import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShareController } from './share.controller';
import { ShareService } from './services/share.service';
import { FileAccessValidationService } from './services/file-access-validation.service';
import {
  FileAccessEntity,
  FileAccessSchema,
} from './schemas/file-access.schema';
import { FileEntity, FileSchema } from '../files/schemas/file.schema';
import { UserEntity, UserSchema } from '../users/schemas/user.schema';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileAccessEntity.name, schema: FileAccessSchema },
      { name: FileEntity.name, schema: FileSchema },
      { name: UserEntity.name, schema: UserSchema },
    ]),
    AuditModule,
  ],
  controllers: [ShareController],
  providers: [ShareService, FileAccessValidationService],
  exports: [ShareService, FileAccessValidationService],
})
export class SharesModule {}
