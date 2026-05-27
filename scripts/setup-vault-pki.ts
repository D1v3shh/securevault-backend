/**
 * Vault PKI Setup Script for Development.
 *
 * Run this script AFTER Vault dev server is running to configure PKI engine.
 * Usage: npx ts-node scripts/setup-vault-pki.ts
 *
 * Prerequisites:
 *   docker-compose up -d vault
 */

async function setupVaultPki() {
  const VAULT_ADDR = process.env.VAULT_ADDR || 'http://localhost:8200';
  const VAULT_TOKEN = process.env.VAULT_TOKEN || 'dev-root-token';

  const headers = {
    'X-Vault-Token': VAULT_TOKEN,
    'Content-Type': 'application/json',
  };

  console.log(`\n🔐 Setting up Vault PKI at ${VAULT_ADDR}\n`);

  try {
    // 1. Enable PKI secrets engine (Root CA)
    console.log('1️⃣  Enabling PKI secrets engine (root)...');
    await fetch(`${VAULT_ADDR}/v1/sys/mounts/pki`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'pki',
        config: { max_lease_ttl: '87600h' }, // 10 years
      }),
    });

    // 2. Generate Root CA
    console.log('2️⃣  Generating Root CA...');
    const rootCaRes = await fetch(`${VAULT_ADDR}/v1/pki/root/generate/internal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        common_name: 'SecureVault Root CA',
        issuer_name: 'securevault-root',
        ttl: '87600h',
        key_type: 'rsa',
        key_bits: 4096,
      }),
    });
    const rootCa = await rootCaRes.json();
    console.log(`   ✅ Root CA created: ${rootCa.data?.issuer_id || 'OK'}`);

    // 3. Configure Root CA URLs
    console.log('3️⃣  Configuring Root CA URLs...');
    await fetch(`${VAULT_ADDR}/v1/pki/config/urls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        issuing_certificates: `${VAULT_ADDR}/v1/pki/ca`,
        crl_distribution_points: `${VAULT_ADDR}/v1/pki/crl`,
      }),
    });

    // 4. Enable Intermediate PKI secrets engine
    console.log('4️⃣  Enabling Intermediate PKI secrets engine...');
    await fetch(`${VAULT_ADDR}/v1/sys/mounts/pki_int`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'pki',
        config: { max_lease_ttl: '43800h' }, // 5 years
      }),
    });

    // 5. Generate Intermediate CSR
    console.log('5️⃣  Generating Intermediate CA CSR...');
    const intCsrRes = await fetch(`${VAULT_ADDR}/v1/pki_int/intermediate/generate/internal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        common_name: 'SecureVault Intermediate CA',
        issuer_name: 'securevault-intermediate',
        key_type: 'rsa',
        key_bits: 4096,
      }),
    });
    const intCsr = await intCsrRes.json();
    const csr = intCsr.data?.csr;

    if (!csr) {
      console.error('   ❌ Failed to generate intermediate CSR');
      return;
    }

    // 6. Sign Intermediate CSR with Root CA
    console.log('6️⃣  Signing Intermediate CA with Root CA...');
    const signRes = await fetch(`${VAULT_ADDR}/v1/pki/root/sign-intermediate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csr,
        format: 'pem_bundle',
        ttl: '43800h',
      }),
    });
    const signed = await signRes.json();
    const signedCert = signed.data?.certificate;

    // 7. Set Intermediate CA signed certificate
    console.log('7️⃣  Setting signed Intermediate CA certificate...');
    await fetch(`${VAULT_ADDR}/v1/pki_int/intermediate/set-signed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ certificate: signedCert }),
    });

    // 8. Configure Intermediate CA URLs
    console.log('8️⃣  Configuring Intermediate CA URLs...');
    await fetch(`${VAULT_ADDR}/v1/pki_int/config/urls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        issuing_certificates: `${VAULT_ADDR}/v1/pki_int/ca`,
        crl_distribution_points: `${VAULT_ADDR}/v1/pki_int/crl`,
      }),
    });

    // 9. Create a role for device certificate issuance
    console.log('9️⃣  Creating PKI role "securevault-device"...');
    await fetch(`${VAULT_ADDR}/v1/pki_int/roles/securevault-device`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        allowed_domains: ['securevault.local'],
        allow_subdomains: true,
        allow_any_name: true,
        enforce_hostnames: false,
        max_ttl: '8760h', // 1 year
        key_type: 'rsa',
        key_bits: 4096,
        key_usage: ['DigitalSignature', 'KeyEncipherment'],
        ext_key_usage: ['ClientAuth'],
        require_cn: true,
        generate_lease: true,
      }),
    });

    console.log('\n✅ Vault PKI setup complete!\n');
    console.log('Summary:');
    console.log('  • Root CA: CN=SecureVault Root CA');
    console.log('  • Intermediate CA: CN=SecureVault Intermediate CA');
    console.log('  • Device Role: securevault-device');
    console.log('  • PKI Path: pki_int');
    console.log(`  • Vault Address: ${VAULT_ADDR}`);
    console.log('\nYou can now enroll devices via the SetupApp API.\n');

  } catch (error: any) {
    console.error(`\n❌ Setup failed: ${error.message}\n`);
    process.exit(1);
  }
}

setupVaultPki();
