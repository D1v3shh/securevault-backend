import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { ENCRYPTION_PROVIDER } from './interfaces/encryption-provider.interface';
import { KEY_MANAGEMENT_PROVIDER } from './interfaces/key-management-provider.interface';

@Module({
  providers: [
    EncryptionService,
    { provide: ENCRYPTION_PROVIDER, useExisting: EncryptionService },
    { provide: KEY_MANAGEMENT_PROVIDER, useExisting: EncryptionService },
  ],
  exports: [EncryptionService, ENCRYPTION_PROVIDER, KEY_MANAGEMENT_PROVIDER],
})
export class EncryptionModule {}
