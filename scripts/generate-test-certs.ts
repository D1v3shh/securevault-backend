/**
 * ============================================================
 * SecureVault — Test Certificate Generator
 * ============================================================
 *
 * Generates REAL X.509 certificates for testing the certificate-
 * based login flow via Swagger UI.
 *
 * This script:
 *   1. Creates a self-signed Root CA
 *   2. Creates an Intermediate CA signed by Root
 *   3. Generates client certificates for each role:
 *      - SUPER_ADMIN  → super-admin@securevault.local
 *      - ADMIN        → admin@securevault.local
 *      - MANAGER      → manager@securevault.local
 *      - EMPLOYEE     → employee@securevault.local
 *   4. Creates matching users, devices, and certificate records in MongoDB
 *   5. Outputs the PEM certificates for use in Swagger/Postman
 *
 * Usage:
 *   npx ts-node scripts/generate-test-certs.ts
 *
 * Prerequisites:
 *   - MongoDB running (docker-compose up -d mongodb)
 *   - npm install (node-forge must be installed)
 */

import * as forge from 'node-forge';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─── MongoDB Connection ──────────────────────────────────

const MONGO_URI = process.env.MONGODB_URI ||
  'mongodb://securevault_user:securevault_pass_dev@localhost:27017/securevault?authSource=admin';

// ─── Role Definitions ────────────────────────────────────

interface TestIdentity {
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  department: string;
  deviceHostname: string;
}

const TEST_IDENTITIES: TestIdentity[] = [
  {
    role: 'SUPER_ADMIN',
    email: 'superadmin-test@securevault.local',
    firstName: 'Test',
    lastName: 'SuperAdmin',
    employeeId: 'EMP-SA-001',
    department: 'IT Security',
    deviceHostname: 'SA-WORKSTATION-001',
  },
  {
    role: 'ADMIN',
    email: 'admin-test@securevault.local',
    firstName: 'Test',
    lastName: 'Admin',
    employeeId: 'EMP-ADM-001',
    department: 'IT Operations',
    deviceHostname: 'ADM-WORKSTATION-001',
  },
  {
    role: 'MANAGER',
    email: 'manager-test@securevault.local',
    firstName: 'Test',
    lastName: 'Manager',
    employeeId: 'EMP-MGR-001',
    department: 'Engineering',
    deviceHostname: 'MGR-WORKSTATION-001',
  },
  {
    role: 'EMPLOYEE',
    email: 'employee-test@securevault.local',
    firstName: 'Test',
    lastName: 'Employee',
    employeeId: 'EMP-EMP-001',
    department: 'Development',
    deviceHostname: 'EMP-WORKSTATION-001',
  },
];

// ─── Certificate Generation ──────────────────────────────

function generateKeyPair(): { publicKey: forge.pki.rsa.PublicKey; privateKey: forge.pki.rsa.PrivateKey } {
  return forge.pki.rsa.generateKeyPair({ bits: 2048 });
}

function createRootCA(): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = generateKeyPair();
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'SecureVault Test Root CA' },
    { name: 'countryName', value: 'IN' },
    { name: 'organizationName', value: 'SecureVault Test PKI' },
    { name: 'organizationalUnitName', value: 'Certificate Authority' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function createIntermediateCA(
  rootCA: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey },
): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = generateKeyPair();
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);

  cert.setSubject([
    { name: 'commonName', value: 'SecureVault Test Intermediate CA' },
    { name: 'countryName', value: 'IN' },
    { name: 'organizationName', value: 'SecureVault Test PKI' },
    { name: 'organizationalUnitName', value: 'Intermediate CA' },
  ]);

  cert.setIssuer(rootCA.cert.subject.attributes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
  ]);

  cert.sign(rootCA.key, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function createClientCertificate(
  intermediateCA: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey },
  identity: TestIdentity,
  deviceId: string,
): {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  pem: string;
  serialNumber: string;
  fingerprint: string;
} {
  const keys = generateKeyPair();
  const cert = forge.pki.createCertificate();

  // Generate unique serial
  const serialHex = crypto.randomBytes(16).toString('hex');
  cert.serialNumber = serialHex;

  cert.publicKey = keys.publicKey;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const commonName = `${identity.employeeId}.${deviceId}.securevault.local`;

  cert.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'countryName', value: 'IN' },
    { name: 'organizationName', value: 'SecureVault' },
    { name: 'organizationalUnitName', value: identity.department },
    { shortName: 'E', value: identity.email },
  ]);

  cert.setIssuer(intermediateCA.cert.subject.attributes);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: 'extKeyUsage',
      clientAuth: true,
    },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: commonName }, // DNS
        { type: 1, value: identity.email }, // email
      ],
    },
  ]);

  cert.sign(intermediateCA.key, forge.md.sha256.create());

  const pem = forge.pki.certificateToPem(cert);

  // Compute SHA-256 fingerprint
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');

  // Format serial as colon-separated uppercase hex
  const formattedSerial = serialHex.match(/.{2}/g)!.join(':').toUpperCase();

  return { cert, key: keys.privateKey, pem, serialNumber: formattedSerial, fingerprint };
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log('\n🔐 SecureVault Test Certificate Generator\n');
  console.log('═'.repeat(60));

  // 1. Generate CA hierarchy
  console.log('\n📜 Generating Certificate Authority hierarchy...\n');

  console.log('  → Creating Root CA...');
  const rootCA = createRootCA();
  const rootPem = forge.pki.certificateToPem(rootCA.cert);
  console.log('    ✅ Root CA: CN=SecureVault Test Root CA');

  console.log('  → Creating Intermediate CA...');
  const intermediateCA = createIntermediateCA(rootCA);
  const intermediatePem = forge.pki.certificateToPem(intermediateCA.cert);
  console.log('    ✅ Intermediate CA: CN=SecureVault Test Intermediate CA');

  // 2. Connect to MongoDB
  console.log('\n📦 Connecting to MongoDB...');
  const { MongoClient, ObjectId } = require('mongodb');
  const bcrypt = require('bcrypt');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('securevault');
  console.log('    ✅ Connected\n');

  // 3. Generate certificates for each role
  console.log('🎫 Generating client certificates...\n');

  const outputDir = path.join(__dirname, '..', 'test-certificates');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save CA certs
  fs.writeFileSync(path.join(outputDir, 'root-ca.pem'), rootPem);
  fs.writeFileSync(path.join(outputDir, 'intermediate-ca.pem'), intermediatePem);

  const results: Array<{
    role: string;
    email: string;
    employeeId: string;
    deviceId: string;
    deviceFingerprint: string;
    serialNumber: string;
    certPem: string;
  }> = [];

  for (const identity of TEST_IDENTITIES) {
    const deviceId = `dev-test-${identity.role.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
    const deviceFingerprint = crypto.createHash('sha256')
      .update(`${identity.deviceHostname}|AA:BB:CC:DD:EE:${identity.role.substring(0, 2)}|SN-TEST-${identity.role}|win32|x64`)
      .digest('hex');

    // Generate certificate
    const clientCert = createClientCertificate(intermediateCA, identity, deviceId);

    console.log(`  ${identity.role}`);
    console.log(`    Email:       ${identity.email}`);
    console.log(`    Employee ID: ${identity.employeeId}`);
    console.log(`    Device ID:   ${deviceId}`);
    console.log(`    Serial:      ${clientCert.serialNumber}`);
    console.log(`    Fingerprint: ${clientCert.fingerprint.substring(0, 32)}...`);

    // Save cert to file
    const certFileName = `${identity.role.toLowerCase()}-cert.pem`;
    const keyFileName = `${identity.role.toLowerCase()}-key.pem`;
    fs.writeFileSync(path.join(outputDir, certFileName), clientCert.pem);
    fs.writeFileSync(path.join(outputDir, keyFileName), forge.pki.privateKeyToPem(clientCert.key));

    // ─── Seed MongoDB ──────────────────────────────

    // Upsert user
    const existingUser = await db.collection('users').findOne({ email: identity.email });
    let userId: any;

    if (existingUser) {
      userId = existingUser._id;
      console.log(`    → User exists (${userId})`);
    } else {
      const passwordHash = await bcrypt.hash('TestPass@123', 12);
      const user = await db.collection('users').insertOne({
        uuid: crypto.randomUUID(),
        email: identity.email,
        passwordHash,
        firstName: identity.firstName,
        lastName: identity.lastName,
        role: identity.role,
        isActive: true,
        isFirstLogin: false,
        mustChangePassword: false,
        department: identity.department,
        createdBy: 'system:test-cert-gen',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      userId = user.insertedId;
      console.log(`    → User created (${userId})`);
    }

    // Upsert device
    const existingDevice = await db.collection('devices').findOne({ fingerprint: deviceFingerprint });
    if (!existingDevice) {
      await db.collection('devices').insertOne({
        deviceId,
        userId: new ObjectId(userId),
        employeeId: identity.employeeId,
        fingerprint: deviceFingerprint,
        hostname: identity.deviceHostname,
        platform: 'win32',
        arch: 'x64',
        osVersion: 'Windows 11 Pro (Test)',
        macAddress: `AA:BB:CC:DD:EE:${identity.role.substring(0, 2)}`,
        serialNumber: `SN-TEST-${identity.role}`,
        status: 'approved',
        certificateSerial: clientCert.serialNumber,
        approvedAt: new Date(),
        approvedBy: 'system:test-cert-gen',
        enrolledBy: 'system:test-cert-gen',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`    → Device created & approved`);
    } else {
      // Update existing device with new cert serial
      await db.collection('devices').updateOne(
        { fingerprint: deviceFingerprint },
        { $set: { certificateSerial: clientCert.serialNumber, deviceId, status: 'approved' } },
      );
      console.log(`    → Device updated`);
    }

    // Insert certificate record
    await db.collection('certificates').deleteMany({ employeeId: identity.employeeId, status: 'active' });
    await db.collection('certificates').insertOne({
      uuid: crypto.randomUUID(),
      serialNumber: clientCert.serialNumber,
      userId: new ObjectId(userId),
      employeeId: identity.employeeId,
      deviceId,
      deviceFingerprint,
      fingerprint: clientCert.fingerprint,
      issuer: 'CN=SecureVault Test Intermediate CA',
      subject: `CN=${identity.employeeId}.${deviceId}.securevault.local`,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certificatePem: clientCert.pem,
      csrPem: null,
      keyType: 'RSA',
      keySize: 2048,
      signatureAlgorithm: 'SHA256',
      status: 'active',
      renewalCount: 0,
      metadata: { generatedBy: 'test-cert-generator', testCert: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`    → Certificate stored in DB`);
    console.log('');

    results.push({
      role: identity.role,
      email: identity.email,
      employeeId: identity.employeeId,
      deviceId,
      deviceFingerprint,
      serialNumber: clientCert.serialNumber,
      certPem: clientCert.pem,
    });
  }

  // 4. Write summary JSON for the dev controller to consume
  const summaryPath = path.join(outputDir, 'test-certs-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  // 5. Print final summary
  console.log('═'.repeat(60));
  console.log('\n✅ Test certificates generated successfully!\n');
  console.log('📂 Output directory: test-certificates/');
  console.log('');
  console.log('Files:');
  console.log('  root-ca.pem              — Root CA certificate');
  console.log('  intermediate-ca.pem      — Intermediate CA certificate');
  console.log('  super_admin-cert.pem     — SUPER_ADMIN client cert');
  console.log('  admin-cert.pem           — ADMIN client cert');
  console.log('  manager-cert.pem         — MANAGER client cert');
  console.log('  employee-cert.pem        — EMPLOYEE client cert');
  console.log('  *-key.pem                — Corresponding private keys');
  console.log('  test-certs-summary.json  — Machine-readable summary');
  console.log('');
  console.log('─'.repeat(60));
  console.log('📋 Quick Test via Swagger UI:');
  console.log('─'.repeat(60));
  console.log('');
  console.log('1. Start the server: npm run start:dev');
  console.log('2. Open: http://localhost:3000/api/docs');
  console.log('3. Go to: [Dev Testing] → GET /dev/test-certificates');
  console.log('4. Pick any certificate PEM + its deviceFingerprint');
  console.log('5. Go to: [Authentication] → POST /auth/certificate-login');
  console.log('6. Paste the certificate PEM and deviceFingerprint');
  console.log('7. You get JWT tokens! 🎉');
  console.log('');
  console.log('Or use the shortcut:');
  console.log('  [Dev Testing] → POST /dev/quick-cert-login');
  console.log('  Body: { "employeeId": "EMP-SA-001" }');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
