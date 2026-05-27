import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultPkiService } from './vault-pki.service';
import { VAULT_PROVIDER } from './interfaces/vault-provider.interface';

/**
 * Global Vault module — available to all other modules without importing.
 * Provides both KV secret management (VaultService) and PKI certificate signing (VaultPkiService).
 */
@Global()
@Module({
  providers: [
    VaultService,
    VaultPkiService,
    {
      provide: VAULT_PROVIDER,
      useExisting: VaultService,
    },
  ],
  exports: [VaultService, VaultPkiService, VAULT_PROVIDER],
})
export class VaultModule {}
