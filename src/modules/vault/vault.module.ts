import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VAULT_PROVIDER } from './interfaces/vault-provider.interface';

/**
 * Global Vault module — available to all other modules without importing.
 * Provides both the concrete VaultService and the VAULT_PROVIDER token.
 */
@Global()
@Module({
  providers: [
    VaultService,
    {
      provide: VAULT_PROVIDER,
      useExisting: VaultService,
    },
  ],
  exports: [VaultService, VAULT_PROVIDER],
})
export class VaultModule {}
