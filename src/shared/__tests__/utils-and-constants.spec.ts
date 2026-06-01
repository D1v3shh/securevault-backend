import { CryptoUtil } from '../utils/crypto.util';
import { FileUtil } from '../utils/file.util';
import { APP_CONSTANTS } from '../constants/app.constants';

// ─── CryptoUtil ─────────────────────────────────────────

describe('CryptoUtil', () => {
  describe('generateRandomKey', () => {
    it('should generate a 32-byte key by default', () => {
      const key = CryptoUtil.generateRandomKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should generate key of specified length', () => {
      const key = CryptoUtil.generateRandomKey(16);
      expect(key.length).toBe(16);
    });

    it('should generate unique keys', () => {
      const key1 = CryptoUtil.generateRandomKey();
      const key2 = CryptoUtil.generateRandomKey();
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });
  });

  describe('generateIV', () => {
    it('should generate 16-byte IV by default', () => {
      const iv = CryptoUtil.generateIV();
      expect(iv).toBeInstanceOf(Buffer);
      expect(iv.length).toBe(16);
    });

    it('should generate IV of specified length', () => {
      const iv = CryptoUtil.generateIV(12);
      expect(iv.length).toBe(12);
    });
  });

  describe('generateUUID', () => {
    it('should generate a valid UUID v4 format', () => {
      const uuid = CryptoUtil.generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique UUIDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => CryptoUtil.generateUUID()));
      expect(ids.size).toBe(100);
    });
  });

  describe('sha256', () => {
    it('should hash a string correctly', () => {
      const hash = CryptoUtil.sha256('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash a Buffer correctly', () => {
      const hash = CryptoUtil.sha256(Buffer.from('hello'));
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should produce different hashes for different inputs', () => {
      expect(CryptoUtil.sha256('a')).not.toBe(CryptoUtil.sha256('b'));
    });
  });

  describe('sha512', () => {
    it('should produce a 128-char hex string', () => {
      const hash = CryptoUtil.sha512('test');
      expect(hash.length).toBe(128);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('generateSecureToken', () => {
    it('should generate 64-char hex token by default (32 bytes)', () => {
      const token = CryptoUtil.generateSecureToken();
      expect(token.length).toBe(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate token of specified byte length', () => {
      const token = CryptoUtil.generateSecureToken(16);
      expect(token.length).toBe(32); // 16 bytes = 32 hex chars
    });
  });

  describe('generateKeyId', () => {
    it('should produce key ID in correct format', () => {
      const keyId = CryptoUtil.generateKeyId();
      expect(keyId).toMatch(/^key-[a-z0-9]+-[0-9a-f]{16}$/);
    });

    it('should generate unique key IDs', () => {
      const id1 = CryptoUtil.generateKeyId();
      const id2 = CryptoUtil.generateKeyId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('secureCompare', () => {
    it('should return true for identical strings', () => {
      expect(CryptoUtil.secureCompare('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings of same length', () => {
      expect(CryptoUtil.secureCompare('abc', 'abd')).toBe(false);
    });

    it('should return false for strings of different length', () => {
      expect(CryptoUtil.secureCompare('abc', 'abcd')).toBe(false);
    });
  });
});

// ─── FileUtil ─────────────────────────────────────────

describe('FileUtil', () => {
  describe('isAllowedMimeType', () => {
    it('should allow PDF', () => {
      expect(FileUtil.isAllowedMimeType('application/pdf')).toBe(true);
    });

    it('should allow common image types', () => {
      expect(FileUtil.isAllowedMimeType('image/jpeg')).toBe(true);
      expect(FileUtil.isAllowedMimeType('image/png')).toBe(true);
      expect(FileUtil.isAllowedMimeType('image/webp')).toBe(true);
    });

    it('should allow office documents', () => {
      expect(FileUtil.isAllowedMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
      expect(FileUtil.isAllowedMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    });

    it('should reject executable types', () => {
      expect(FileUtil.isAllowedMimeType('application/x-executable')).toBe(false);
      expect(FileUtil.isAllowedMimeType('application/x-msdos-program')).toBe(false);
    });

    it('should reject unknown types', () => {
      expect(FileUtil.isAllowedMimeType('application/octet-stream')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('should keep safe filenames unchanged', () => {
      expect(FileUtil.sanitizeFilename('report.pdf')).toBe('report.pdf');
    });

    it('should replace spaces with underscores', () => {
      expect(FileUtil.sanitizeFilename('my report.pdf')).toBe('my_report.pdf');
    });

    it('should remove path traversal attempts', () => {
      expect(FileUtil.sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(FileUtil.sanitizeFilename('..\\..\\windows\\system32\\config')).toBe('config');
    });

    it('should handle special characters', () => {
      const result = FileUtil.sanitizeFilename('file (copy) [2].txt');
      expect(result).not.toContain('(');
      expect(result).not.toContain('[');
    });

    it('should preserve dots, hyphens, and underscores', () => {
      expect(FileUtil.sanitizeFilename('my-file_v2.0.tar.gz')).toBe('my-file_v2.0.tar.gz');
    });
  });

  describe('getExtension', () => {
    it('should return lowercase extension', () => {
      expect(FileUtil.getExtension('photo.JPG')).toBe('.jpg');
    });

    it('should return empty string for no extension', () => {
      expect(FileUtil.getExtension('README')).toBe('');
    });

    it('should return last extension for multiple dots', () => {
      expect(FileUtil.getExtension('archive.tar.gz')).toBe('.gz');
    });
  });

  describe('generateStoragePath', () => {
    it('should generate date-based path', () => {
      const path = FileUtil.generateStoragePath('test-uuid', '.pdf');
      expect(path).toMatch(/^\d{4}\/\d{2}\/\d{2}\/test-uuid\.pdf$/);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(FileUtil.formatFileSize(500)).toBe('500.00 B');
    });

    it('should format kilobytes', () => {
      expect(FileUtil.formatFileSize(1024)).toBe('1.00 KB');
    });

    it('should format megabytes', () => {
      expect(FileUtil.formatFileSize(1048576)).toBe('1.00 MB');
    });

    it('should format gigabytes', () => {
      expect(FileUtil.formatFileSize(1073741824)).toBe('1.00 GB');
    });

    it('should format fractional values', () => {
      expect(FileUtil.formatFileSize(1536)).toBe('1.50 KB');
    });
  });
});

// ─── APP_CONSTANTS ────────────────────────────────────

describe('APP_CONSTANTS', () => {
  it('should have bcrypt salt rounds >= 10', () => {
    expect(APP_CONSTANTS.BCRYPT_SALT_ROUNDS).toBeGreaterThanOrEqual(10);
  });

  it('should have reasonable lockout settings', () => {
    expect(APP_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(APP_CONSTANTS.LOCKOUT_DURATION_MINUTES).toBeGreaterThanOrEqual(5);
  });

  it('should have non-empty ALLOWED_MIME_TYPES', () => {
    expect(APP_CONSTANTS.ALLOWED_MIME_TYPES.length).toBeGreaterThan(0);
    expect(APP_CONSTANTS.ALLOWED_MIME_TYPES).toContain('application/pdf');
  });

  it('should have pagination defaults', () => {
    expect(APP_CONSTANTS.DEFAULT_PAGE).toBe(1);
    expect(APP_CONSTANTS.DEFAULT_PAGE_SIZE).toBe(20);
    expect(APP_CONSTANTS.MAX_PAGE_SIZE).toBeGreaterThanOrEqual(APP_CONSTANTS.DEFAULT_PAGE_SIZE);
  });

  it('should have Vault key prefixes', () => {
    expect(APP_CONSTANTS.VAULT_FILE_KEY_PREFIX).toBeTruthy();
    expect(APP_CONSTANTS.VAULT_MASTER_KEY).toBeTruthy();
  });
});
