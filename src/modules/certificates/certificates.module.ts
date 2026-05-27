import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CertificateEntity, CertificateSchema } from './schemas/certificate.schema';
import {
  CertificateRevocationEntity, CertificateRevocationSchema,
} from './schemas/certificate-revocation.schema';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { DevicesModule } from '../devices/devices.module';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CertificateEntity.name, schema: CertificateSchema },
      { name: CertificateRevocationEntity.name, schema: CertificateRevocationSchema },
    ]),
    DevicesModule,
    VaultModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService, MongooseModule],
})
export class CertificatesModule {}
