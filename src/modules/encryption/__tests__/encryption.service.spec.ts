import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EncryptionService } from '../encryption.service';
import { VaultService } from '../../vault/vault.service';
import { APP_CONSTANTS } from '../../../shared/constants/app.constants';

/** Deterministic master KEK so wrap/unwrap assertions are reproducible. */
const MASTER_KEY_HEX = 'a'.repeat(64);
const JWT_SECRET = 'jwt-access-secret-for-fallback-derivation';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let vaultService: {
    readSecret: jest.Mock;
    writeSecret: jest.Mock;
    deleteSecret: jest.Mock;
    healthCheck: jest.Mock;
  };

  /** Boot the service with the master key loaded from Vault. */
  const initFromVault = async () => {
    vaultService.readSecret.mockResolvedValue({ key: MASTER_KEY_HEX });
    await service.onModuleInit();
    vaultService.readSecret.mockReset();
    vaultService.writeSecret.mockClear();
  };

  beforeEach(async () => {
    vaultService = {
      readSecret: jest.fn().mockResolvedValue(null),
      writeSecret: jest.fn().mockResolvedValue(undefined),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: VaultService, useValue: vaultService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) =>
              key === 'jwt.accessSecret' ? JWT_SECRET : fallback,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Master key initialisation ───────────────────────

  describe('onModuleInit', () => {
    it('should load the master key from Vault when present', async () => {
      vaultService.readSecret.mockResolvedValue({ key: MASTER_KEY_HEX });

      await service.onModuleInit();

      expect(vaultService.readSecret).toHaveBeenCalledWith(
        APP_CONSTANTS.VAULT_MASTER_KEY,
      );
      // Never generates or overwrites when Vault already holds a key.
      expect(vaultService.writeSecret).not.toHaveBeenCalled();
    });

    it('should generate and store a key when Vault is healthy but empty', async () => {
      vaultService.readSecret.mockResolvedValue(null);
      vaultService.healthCheck.mockResolvedValue(true);

      await service.onModuleInit();

      expect(vaultService.writeSecret).toHaveBeenCalledWith(
        APP_CONSTANTS.VAULT_MASTER_KEY,
        expect.objectContaining({
          key: expect.stringMatching(/^[0-9a-f]{64}$/),
          algorithm: 'aes-256-gcm',
        }),
      );
    });

    it('should fall back to a key derived from the JWT secret when Vault is unavailable', async () => {
      vaultService.readSecret.mockRejectedValue(new Error('vault offline'));

      await service.onModuleInit();

      // Documents the dev-only fallback: sha256(JWT_ACCESS_SECRET).
      const derived = crypto
        .createHash('sha256')
        .update(JWT_SECRET)
        .digest('hex');
      const probe = await service.encryptKey(Buffer.alloc(32, 9));
      const unwrapped = await service.decryptKey(probe);
      expect(unwrapped).toEqual(Buffer.alloc(32, 9));

      // The derived key is what is in use, not a random one.
      const svc = service as unknown as { masterKey: Buffer };
      expect(svc.masterKey.toString('hex')).toBe(derived);
      expect(vaultService.writeSecret).not.toHaveBeenCalled();
    });
  });

  // ─── encrypt / decrypt round trip ────────────────────

  describe('encrypt / decrypt', () => {
    beforeEach(initFromVault);

    it('should round-trip data using the master key', async () => {
      const plaintext = Buffer.from('the quick brown fox');

      const { encryptedData, iv, authTag } = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(
        encryptedData,
        undefined,
        iv,
        authTag,
      );

      expect(decrypted).toEqual(plaintext);
      expect(encryptedData).not.toEqual(plaintext);
      expect(iv).toHaveLength(16);
      expect(authTag).toHaveLength(16);
    });

    it('should round-trip data using an explicit DEK', async () => {
      const dek = crypto.randomBytes(32);
      const plaintext = Buffer.from('per-file payload');

      const { encryptedData, iv, authTag } = await service.encrypt(
        plaintext,
        dek,
      );
      const decrypted = await service.decrypt(encryptedData, dek, iv, authTag);

      expect(decrypted).toEqual(plaintext);
    });

    it('should use a fresh IV for every call', async () => {
      const plaintext = Buffer.from('same input');

      const first = await service.encrypt(plaintext);
      const second = await service.encrypt(plaintext);

      // IV reuse under a fixed key is catastrophic for GCM.
      expect(first.iv.equals(second.iv)).toBe(false);
      expect(first.encryptedData.equals(second.encryptedData)).toBe(false);
    });

    it('should reject tampered ciphertext via the GCM auth tag', async () => {
      const { encryptedData, iv, authTag } = await service.encrypt(
        Buffer.from('sensitive'),
      );
      const tampered = Buffer.from(encryptedData);
      tampered[0] ^= 0xff;

      await expect(
        service.decrypt(tampered, undefined, iv, authTag),
      ).rejects.toThrow();
    });

    it('should reject a wrong auth tag', async () => {
      const { encryptedData, iv } = await service.encrypt(
        Buffer.from('sensitive'),
      );

      await expect(
        service.decrypt(encryptedData, undefined, iv, Buffer.alloc(16, 1)),
      ).rejects.toThrow();
    });

    it('should reject decryption under a different key', async () => {
      const { encryptedData, iv, authTag } = await service.encrypt(
        Buffer.from('sensitive'),
        crypto.randomBytes(32),
      );

      await expect(
        service.decrypt(encryptedData, crypto.randomBytes(32), iv, authTag),
      ).rejects.toThrow();
    });

    it('should require iv and authTag', async () => {
      const { encryptedData, iv } = await service.encrypt(Buffer.from('x'));

      await expect(service.decrypt(encryptedData)).rejects.toThrow(
        'IV and authTag are required for decryption',
      );
      await expect(
        service.decrypt(encryptedData, undefined, iv),
      ).rejects.toThrow('IV and authTag are required for decryption');
    });

    it('should refuse to encrypt before the master key is initialised', async () => {
      const uninitialised = new EncryptionService(
        { get: jest.fn((_k: string, f?: unknown) => f) } as never,
        vaultService as never,
      );

      await expect(uninitialised.encrypt(Buffer.from('x'))).rejects.toThrow(
        'Encryption key not initialized',
      );
    });
  });

  // ─── Envelope encryption (DEK wrapping) ──────────────

  describe('generateKey / encryptKey / decryptKey', () => {
    beforeEach(initFromVault);

    it('should generate a DEK that unwraps back to itself', async () => {
      const { keyId, key, encryptedKey } = await service.generateKey();

      expect(keyId).toBeTruthy();
      expect(key).toHaveLength(32);
      await expect(service.decryptKey(encryptedKey)).resolves.toEqual(key);
    });

    it('should pack the wrapped DEK as [iv(16)][authTag(16)][ciphertext(32)]', async () => {
      const dek = crypto.randomBytes(32);

      const wrapped = await service.encryptKey(dek);

      // Fixed offsets — decryptKey slices on them, so the layout is load-bearing.
      expect(wrapped).toHaveLength(16 + 16 + 32);
      await expect(service.decryptKey(wrapped)).resolves.toEqual(dek);
    });

    it('should store the wrapped DEK in Vault under the file-key prefix', async () => {
      const { keyId } = await service.generateKey();

      expect(vaultService.writeSecret).toHaveBeenCalledWith(
        `${APP_CONSTANTS.VAULT_FILE_KEY_PREFIX}${keyId}`,
        expect.objectContaining({
          encryptedKey: expect.any(String),
        }),
      );
    });

    it('should still return the DEK when Vault storage fails', async () => {
      vaultService.writeSecret.mockRejectedValue(new Error('vault offline'));

      const { key, encryptedKey } = await service.generateKey();

      // Upload must not fail just because the Vault copy could not be written;
      // the wrapped DEK is persisted on the file document regardless.
      await expect(service.decryptKey(encryptedKey)).resolves.toEqual(key);
    });

    it('should return null from getKey when Vault has no record', async () => {
      vaultService.readSecret.mockResolvedValue(null);

      await expect(service.getKey('missing-key-id')).resolves.toBeNull();
    });
  });

  // ─── rotateKey: the documented trap ──────────────────

  describe('rotateKey', () => {
    beforeEach(initFromVault);

    it('should NOT re-encrypt existing DEKs — previously wrapped keys become unreadable', async () => {
      const dek = crypto.randomBytes(32);
      const wrappedUnderOldKek = await service.encryptKey(dek);

      // Sanity: readable before rotation.
      await expect(service.decryptKey(wrappedUnderOldKek)).resolves.toEqual(
        dek,
      );

      await service.rotateKey();

      // The DEK was wrapped with the previous KEK and was never re-wrapped, so
      // it can no longer be unwrapped. Every file whose encryptedDek predates
      // the rotation is orphaned. rotateKey only replaces the in-memory KEK and
      // the Vault copy, despite what its docstring implies.
      await expect(service.decryptKey(wrappedUnderOldKek)).rejects.toThrow();
    });

    it('should not read or write any file DEKs while rotating', async () => {
      await service.generateKey();
      vaultService.readSecret.mockClear();
      vaultService.writeSecret.mockClear();

      await service.rotateKey();

      // Proof it makes no attempt at re-wrapping: the only Vault write is the
      // master key itself, and nothing under the file-key prefix is touched.
      const touchedFileKeys = [
        ...vaultService.writeSecret.mock.calls,
        ...vaultService.readSecret.mock.calls,
      ].filter(([path]: [string]) =>
        String(path).startsWith(APP_CONSTANTS.VAULT_FILE_KEY_PREFIX),
      );
      expect(touchedFileKeys).toHaveLength(0);

      expect(vaultService.writeSecret).toHaveBeenCalledTimes(1);
      expect(vaultService.writeSecret).toHaveBeenCalledWith(
        APP_CONSTANTS.VAULT_MASTER_KEY,
        expect.objectContaining({ rotatedAt: expect.any(String) }),
      );
    });

    it('should wrap new DEKs under the new KEK after rotation', async () => {
      await service.rotateKey();

      const dek = crypto.randomBytes(32);
      const wrapped = await service.encryptKey(dek);

      await expect(service.decryptKey(wrapped)).resolves.toEqual(dek);
    });

    it('should restore the previous KEK when the Vault write fails', async () => {
      const dek = crypto.randomBytes(32);
      const wrappedUnderOldKek = await service.encryptKey(dek);
      vaultService.writeSecret.mockRejectedValue(new Error('vault offline'));

      await expect(service.rotateKey()).rejects.toThrow('vault offline');

      // Rollback matters: a half-applied rotation would orphan every file.
      await expect(service.decryptKey(wrappedUnderOldKek)).resolves.toEqual(
        dek,
      );
    });
  });
});
