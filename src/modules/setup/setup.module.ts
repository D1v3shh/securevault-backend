import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnrollmentTokenEntity, EnrollmentTokenSchema } from './schemas/enrollment-token.schema';
import { SetupService } from './setup.service';
import { SetupController } from './setup.controller';
import { DevicesModule } from '../devices/devices.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EnrollmentTokenEntity.name, schema: EnrollmentTokenSchema },
    ]),
    DevicesModule,
    CertificatesModule,
    UsersModule,
  ],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService, MongooseModule],
})
export class SetupModule {}
