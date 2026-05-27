import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * HashiCorp Vault PKI engine integration service.
 * Handles:
 *   - CSR signing via Vault PKI intermediate CA
 *   - Certificate revocation via Vault CRL
 *   - Root and intermediate CA certificate retrieval
 *   - Certificate renewal
 *
 * PKI engine must be mounted and configured in Vault with:
 *   - Root CA generated or imported
 *   - Intermediate CA signed by Root
 *   - Roles configured for certificate issuance
 */
@Injectable()
export class VaultPkiService implements OnModuleInit {
  private readonly logger = new Logger(VaultPkiService.name);
  private client: any = null;
  private readonly enabled: boolean;
  private readonly address: string;
  private readonly token: string;
  private readonly pkiPath: string;
  private readonly pkiRoleName: string;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('vault.enabled', false);
    this.address = this.configService.get<string>('vault.address', 'http://localhost:8200');
    this.token = this.configService.get<string>('vault.token', '');
    this.pkiPath = this.configService.get<string>('VAULT_PKI_PATH', 'pki_int');
    this.pkiRoleName = this.configService.get<string>('VAULT_PKI_ROLE', 'securevault-device');
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      await this.initialize();
    } else {
      this.logger.warn(
        'Vault PKI is DISABLED. Certificate signing will use local self-signed fallback. ' +
        'This is acceptable for development only.',
      );
    }
  }

  /**
   * Initialize the Vault client for PKI operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.log(`Connecting to Vault PKI at ${this.address}...`);
      const vault = require('node-vault');
      this.client = vault({
        apiVersion: 'v1',
        endpoint: this.address,
        token: this.token,
      });

      const health = await this.client.health();
      this.initialized = true;
      this.logger.log(`✅ Vault PKI connected. Sealed: ${health.sealed}`);
    } catch (error: any) {
      this.logger.error(`Vault PKI connection failed: ${error.message}`);
    }
  }

  /**
   * Sign a CSR using the Vault PKI intermediate CA.
   * Returns the signed certificate, issuing CA, and serial number.
   */
  async signCsr(params: {
    csr: string;
    commonName: string;
    ttl?: string;
    altNames?: string;
    ipSans?: string;
    uriSans?: string;
    otherSans?: string;
  }): Promise<{
    certificate: string;
    issuingCa: string;
    caChain: string[];
    serialNumber: string;
    expiration: number;
  }> {
    if (!this.enabled || !this.client) {
      this.logger.warn('Vault PKI disabled — returning self-signed mock certificate');
      return this.generateMockCertificate(params.commonName, params.csr);
    }

    try {
      const result = await this.client.write(`${this.pkiPath}/sign/${this.pkiRoleName}`, {
        csr: params.csr,
        common_name: params.commonName,
        ttl: params.ttl || '8760h', // 1 year default
        alt_names: params.altNames || '',
        ip_sans: params.ipSans || '',
        uri_sans: params.uriSans || '',
        other_sans: params.otherSans || '',
        format: 'pem',
      });

      const data = result.data;
      return {
        certificate: data.certificate,
        issuingCa: data.issuing_ca,
        caChain: data.ca_chain || [],
        serialNumber: data.serial_number,
        expiration: data.expiration,
      };
    } catch (error: any) {
      this.logger.error(`CSR signing failed: ${error.message}`);
      throw new Error(`Vault PKI CSR signing failed: ${error.message}`);
    }
  }

  /**
   * Revoke a certificate by its serial number.
   */
  async revokeCertificate(serialNumber: string): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn(`Vault PKI disabled — mock revocation for serial: ${serialNumber}`);
      return;
    }

    try {
      await this.client.write(`${this.pkiPath}/revoke`, {
        serial_number: serialNumber,
      });
      this.logger.log(`Certificate revoked in Vault PKI: ${serialNumber}`);
    } catch (error: any) {
      this.logger.error(`Certificate revocation failed: ${error.message}`);
      throw new Error(`Vault PKI revocation failed: ${error.message}`);
    }
  }

  /**
   * Get the root CA certificate.
   */
  async getRootCaCertificate(): Promise<string> {
    if (!this.enabled || !this.client) {
      return this.getMockRootCa();
    }

    try {
      const result = await this.client.read('pki/cert/ca');
      return result.data.certificate;
    } catch (error: any) {
      this.logger.error(`Failed to read root CA: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the intermediate CA certificate.
   */
  async getIntermediateCaCertificate(): Promise<string> {
    if (!this.enabled || !this.client) {
      return this.getMockIntermediateCa();
    }

    try {
      const result = await this.client.read(`${this.pkiPath}/cert/ca`);
      return result.data.certificate;
    } catch (error: any) {
      this.logger.error(`Failed to read intermediate CA: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the Certificate Revocation List (CRL).
   */
  async getCrl(): Promise<string> {
    if (!this.enabled || !this.client) {
      return '';
    }

    try {
      const result = await this.client.read(`${this.pkiPath}/crl`);
      return result.data.crl || '';
    } catch (error: any) {
      this.logger.error(`Failed to read CRL: ${error.message}`);
      return '';
    }
  }

  /**
   * Tidy up expired certificates and revocation entries in Vault.
   */
  async tidyCertificates(): Promise<void> {
    if (!this.enabled || !this.client) return;

    try {
      await this.client.write(`${this.pkiPath}/tidy`, {
        tidy_cert_store: true,
        tidy_revoked_certs: true,
        safety_buffer: '72h',
      });
      this.logger.log('Vault PKI tidy operation initiated');
    } catch (error: any) {
      this.logger.error(`PKI tidy failed: ${error.message}`);
    }
  }

  /**
   * Check if Vault PKI is healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      if (!this.client) return false;
      const health = await this.client.health();
      return !health.sealed;
    } catch {
      return false;
    }
  }

  // ─── Development Fallbacks ────────────────────────────

  /**
   * Generate a mock self-signed certificate for development.
   * NOT for production use.
   */
  private generateMockCertificate(
    commonName: string,
    csr: string,
  ): {
    certificate: string;
    issuingCa: string;
    caChain: string[];
    serialNumber: string;
    expiration: number;
  } {
    const crypto = require('crypto');
    const serialNumber = crypto.randomBytes(16).toString('hex')
      .match(/.{2}/g)!
      .join(':')
      .toUpperCase();

    const now = new Date();
    const expiration = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

    // In development, we return a placeholder PEM
    // The actual CSR handling requires openssl or forge
    const mockCert = [
      '-----BEGIN CERTIFICATE-----',
      `# DEVELOPMENT MOCK CERTIFICATE`,
      `# CN=${commonName}`,
      `# Serial=${serialNumber}`,
      `# NotBefore=${now.toISOString()}`,
      `# NotAfter=${expiration.toISOString()}`,
      `# CSR-Hash=${crypto.createHash('sha256').update(csr).digest('hex').substring(0, 32)}`,
      Buffer.from(JSON.stringify({
        cn: commonName,
        serial: serialNumber,
        notBefore: now.toISOString(),
        notAfter: expiration.toISOString(),
        issuer: 'CN=SecureVault Dev CA',
        mock: true,
      })).toString('base64'),
      '-----END CERTIFICATE-----',
    ].join('\n');

    return {
      certificate: mockCert,
      issuingCa: this.getMockIntermediateCa(),
      caChain: [this.getMockIntermediateCa(), this.getMockRootCa()],
      serialNumber,
      expiration: Math.floor(expiration.getTime() / 1000),
    };
  }

  private getMockRootCa(): string {
    return [
      '-----BEGIN CERTIFICATE-----',
      '# DEVELOPMENT MOCK ROOT CA',
      '# CN=SecureVault Root CA (Dev)',
      Buffer.from('SecureVault-Dev-Root-CA').toString('base64'),
      '-----END CERTIFICATE-----',
    ].join('\n');
  }

  private getMockIntermediateCa(): string {
    return [
      '-----BEGIN CERTIFICATE-----',
      '# DEVELOPMENT MOCK INTERMEDIATE CA',
      '# CN=SecureVault Intermediate CA (Dev)',
      Buffer.from('SecureVault-Dev-Intermediate-CA').toString('base64'),
      '-----END CERTIFICATE-----',
    ].join('\n');
  }
}
