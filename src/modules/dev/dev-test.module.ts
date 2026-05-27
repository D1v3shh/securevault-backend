import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevTestController } from './dev-test.controller';
import { DevTestService } from './dev-test.service';
import { CertificateEntity, CertificateSchema } from '../certificates/schemas/certificate.schema';
import { DeviceEntity, DeviceSchema } from '../devices/schemas/device.schema';
import { UserEntity, UserSchema } from '../users/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';

/**
 * Development testing module.
 * ⚠️ ONLY imported in non-production environments.
 * Provides certificate selection and quick login endpoints.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CertificateEntity.name, schema: CertificateSchema },
      { name: DeviceEntity.name, schema: DeviceSchema },
      { name: UserEntity.name, schema: UserSchema },
    ]),
    AuthModule,
  ],
  controllers: [DevTestController],
  providers: [DevTestService],
})
export class DevTestModule {}
