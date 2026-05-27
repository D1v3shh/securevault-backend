/**
 * SecureVault — Automated API Test Suite
 * Tests all certificate-based auth and core endpoints
 * Run: npx ts-node scripts/run-api-tests.ts
 */

const BASE_URL = 'http://localhost:3000/api/v1';

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: number;
  passed: boolean;
  duration: number;
  response?: any;
  error?: string;
}

const results: TestResult[] = [];

async function apiCall(
  method: string,
  path: string,
  body?: any,
  token?: string,
): Promise<{ status: number; data: any; duration: number }> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const duration = Date.now() - start;
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { raw: await res.text() };
    }
    return { status: res.status, data, duration };
  } catch (err: any) {
    return { status: 0, data: { error: err.message }, duration: Date.now() - start };
  }
}

function log(test: TestResult) {
  const icon = test.passed ? '✅' : '❌';
  console.log(`  ${icon} [${test.method} ${test.endpoint}] ${test.name} (${test.status}, ${test.duration}ms)`);
  if (!test.passed && test.error) {
    console.log(`     ↳ ${test.error}`);
  }
  results.push(test);
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SecureVault API Test Suite');
  console.log('═══════════════════════════════════════════════════════════\n');

  let adminToken = '';
  let certLoginToken = '';
  let certSerial = '';
  let deviceFingerprint = '';

  // ─── 1. Health Check ──────────────────────────────
  console.log('📡 1. Health Check\n');

  {
    const { status, data, duration } = await apiCall('GET', '/health');
    log({
      name: 'Health endpoint returns OK',
      endpoint: '/health',
      method: 'GET',
      status,
      passed: status === 200,
      duration,
      response: data,
    });
  }

  // ─── 2. Dev Status ────────────────────────────────
  console.log('\n🔧 2. Dev Testing Endpoints\n');

  {
    const { status, data, duration } = await apiCall('GET', '/dev/status');
    log({
      name: 'Dev status shows test certificates generated',
      endpoint: '/dev/status',
      method: 'GET',
      status,
      passed: status === 200 && data?.data?.testCertificates?.generated === true,
      duration,
      response: {
        environment: data?.data?.environment,
        testCertsGenerated: data?.data?.testCertificates?.generated,
        users: data?.data?.database?.users,
        devices: data?.data?.database?.devices,
        activeCerts: data?.data?.database?.activeCertificates,
      },
    });
  }

  // ─── 3. List Test Certificates ────────────────────
  {
    const { status, data, duration } = await apiCall('GET', '/dev/test-certificates');
    const certs = data?.data?.certificates || [];
    log({
      name: 'List test certificates (should return 4)',
      endpoint: '/dev/test-certificates',
      method: 'GET',
      status,
      passed: status === 200 && certs.length >= 4,
      duration,
      response: { count: certs.length, roles: certs.map((c: any) => c.role) },
    });

    // Save first cert data for later tests
    if (certs.length > 0) {
      certSerial = certs[0].serialNumber;
      deviceFingerprint = certs[0].deviceFingerprint;
    }
  }

  // ─── 4. Password Login ────────────────────────────
  console.log('\n🔑 3. Password-Based Authentication\n');

  {
    const { status, data, duration } = await apiCall('POST', '/auth/login', {
      email: 'kumavatdivesh671@gmail.com',
      password: 'DiKu@671',
    });
    const hasToken = !!data?.data?.accessToken;
    adminToken = data?.data?.accessToken || '';
    log({
      name: 'Super Admin password login',
      endpoint: '/auth/login',
      method: 'POST',
      status,
      passed: status === 200 && hasToken,
      duration,
      response: {
        hasAccessToken: hasToken,
        hasRefreshToken: !!data?.data?.refreshToken,
        role: data?.data?.user?.role,
        email: data?.data?.user?.email,
      },
    });
  }

  {
    const { status, data, duration } = await apiCall('POST', '/auth/login', {
      email: 'invalid@securevault.local',
      password: 'WrongPass123',
    });
    log({
      name: 'Invalid credentials rejected',
      endpoint: '/auth/login',
      method: 'POST',
      status,
      passed: status === 401,
      duration,
      error: status !== 401 ? `Expected 401, got ${status}` : undefined,
    });
  }

  // ─── 5. Certificate Login ─────────────────────────
  console.log('\n🎫 4. Certificate-Based Authentication\n');

  // Quick cert login for each role
  const roles = [
    { id: 'EMP-SA-001', role: 'SUPER_ADMIN' },
    { id: 'EMP-ADM-001', role: 'ADMIN' },
    { id: 'EMP-MGR-001', role: 'MANAGER' },
    { id: 'EMP-EMP-001', role: 'EMPLOYEE' },
  ];

  for (const r of roles) {
    const { status, data, duration } = await apiCall('POST', '/dev/quick-cert-login', {
      employeeId: r.id,
    });
    const hasToken = !!data?.data?.accessToken;
    if (r.role === 'SUPER_ADMIN') {
      certLoginToken = data?.data?.accessToken || '';
    }
    log({
      name: `Quick cert login — ${r.role}`,
      endpoint: '/dev/quick-cert-login',
      method: 'POST',
      status,
      passed: status === 200 && hasToken,
      duration,
      response: {
        hasAccessToken: hasToken,
        hasSessionId: !!data?.data?.sessionId,
        role: data?.data?.user?.role,
        deviceId: data?.data?.device?.deviceId,
        certSerial: data?.data?.certificate?.serialNumber,
      },
      error: !hasToken ? `Login failed: ${JSON.stringify(data?.message || data?.data?.message)}` : undefined,
    });
  }

  // Invalid employee ID
  {
    const { status, data, duration } = await apiCall('POST', '/dev/quick-cert-login', {
      employeeId: 'EMP-INVALID-999',
    });
    log({
      name: 'Invalid employee ID rejected',
      endpoint: '/dev/quick-cert-login',
      method: 'POST',
      status,
      passed: status === 400,
      duration,
      error: status !== 400 ? `Expected 400, got ${status}` : undefined,
    });
  }

  // ─── 6. Certificate Verification ──────────────────
  console.log('\n🔍 5. Certificate Verification\n');

  // Get a real cert PEM for manual verify
  {
    const certListRes = await apiCall('GET', '/dev/test-certificates');
    const certs = certListRes.data?.data?.certificates || [];
    if (certs.length > 0) {
      const testCert = certs[0];
      const { status, data, duration } = await apiCall('POST', '/certificates/verify', {
        certificate: testCert.certificatePem,
        deviceFingerprint: testCert.deviceFingerprint,
      });
      log({
        name: 'Verify valid certificate',
        endpoint: '/certificates/verify',
        method: 'POST',
        status,
        passed: status === 200 && data?.data?.valid === true,
        duration,
        response: {
          valid: data?.data?.valid,
          serialNumber: data?.data?.serialNumber,
          employeeId: data?.data?.employeeId,
        },
      });

      // Verify with wrong fingerprint
      const { status: s2, data: d2, duration: dur2 } = await apiCall('POST', '/certificates/verify', {
        certificate: testCert.certificatePem,
        deviceFingerprint: 'wrong_fingerprint_00000000000000000000000000000000',
      });
      log({
        name: 'Reject certificate with wrong fingerprint',
        endpoint: '/certificates/verify',
        method: 'POST',
        status: s2,
        passed: s2 === 200 && d2?.data?.valid === false,
        duration: dur2,
        response: { valid: d2?.data?.valid, reason: d2?.data?.reason },
      });
    }
  }

  // Verify invalid PEM
  {
    const { status, data, duration } = await apiCall('POST', '/certificates/verify', {
      certificate: 'not-a-valid-pem',
    });
    log({
      name: 'Reject invalid PEM format',
      endpoint: '/certificates/verify',
      method: 'POST',
      status,
      passed: status === 200 && data?.data?.valid === false,
      duration,
      response: { valid: data?.data?.valid, reason: data?.data?.reason },
    });
  }

  // ─── 7. Devices ───────────────────────────────────
  console.log('\n📱 6. Device Management\n');

  {
    const { status, data, duration } = await apiCall('GET', '/devices/me', undefined, certLoginToken);
    log({
      name: 'Get my devices (cert-auth user)',
      endpoint: '/devices/me',
      method: 'GET',
      status,
      passed: status === 200,
      duration,
      response: { deviceCount: data?.data?.devices?.length },
    });
  }

  // Unauthenticated access should fail
  {
    const { status, duration } = await apiCall('GET', '/devices/me');
    log({
      name: 'Unauthenticated access rejected',
      endpoint: '/devices/me',
      method: 'GET',
      status,
      passed: status === 401,
      duration,
      error: status !== 401 ? `Expected 401, got ${status}` : undefined,
    });
  }

  // ─── 8. Admin Endpoints ───────────────────────────
  console.log('\n👤 7. Admin Endpoints\n');

  {
    const { status, data, duration } = await apiCall('GET', '/admin/users', undefined, adminToken);
    log({
      name: 'List all users (admin)',
      endpoint: '/admin/users',
      method: 'GET',
      status,
      passed: status === 200,
      duration,
      response: { userCount: data?.data?.data?.length || data?.data?.length },
    });
  }

  {
    const { status, data, duration } = await apiCall('GET', '/admin/devices', undefined, adminToken);
    log({
      name: 'List all devices (admin)',
      endpoint: '/admin/devices',
      method: 'GET',
      status,
      passed: status === 200,
      duration,
      response: { deviceCount: data?.data?.data?.length },
    });
  }

  {
    const { status, data, duration } = await apiCall('GET', '/admin/audit-logs', undefined, adminToken);
    log({
      name: 'View audit logs (admin)',
      endpoint: '/admin/audit-logs',
      method: 'GET',
      status,
      passed: status === 200,
      duration,
      response: { logCount: data?.data?.data?.length },
    });
  }

  // ─── 9. Certificate Status ────────────────────────
  console.log('\n📋 8. Certificate Status\n');

  if (certSerial) {
    const { status, data, duration } = await apiCall(
      'GET', `/certificates/${encodeURIComponent(certSerial)}`, undefined, adminToken,
    );
    log({
      name: 'Get certificate by serial',
      endpoint: `/certificates/:serial`,
      method: 'GET',
      status,
      passed: status === 200 && data?.data?.found === true,
      duration,
      response: {
        found: data?.data?.found,
        status: data?.data?.status,
        employeeId: data?.data?.employeeId,
      },
    });
  }

  // ─── 10. Token Refresh ────────────────────────────
  console.log('\n🔄 9. Token Refresh\n');

  {
    // Login first to get a refresh token
    const loginRes = await apiCall('POST', '/dev/quick-cert-login', { employeeId: 'EMP-EMP-001' });
    const refreshToken = loginRes.data?.data?.refreshToken;

    if (refreshToken) {
      const { status, data, duration } = await apiCall('POST', '/auth/refresh', {
        refreshToken,
      });
      log({
        name: 'Refresh token rotation',
        endpoint: '/auth/refresh',
        method: 'POST',
        status,
        passed: status === 200 && !!data?.data?.accessToken,
        duration,
        response: {
          hasNewAccessToken: !!data?.data?.accessToken,
          hasNewRefreshToken: !!data?.data?.refreshToken,
        },
      });
    }
  }

  // ─── 11. Logout ───────────────────────────────────
  console.log('\n🚪 10. Logout\n');

  {
    // Get a fresh token to test logout
    const loginRes = await apiCall('POST', '/dev/quick-cert-login', { employeeId: 'EMP-MGR-001' });
    const mgrToken = loginRes.data?.data?.accessToken;
    const mgrRefresh = loginRes.data?.data?.refreshToken;

    if (mgrToken) {
      const { status, data, duration } = await apiCall('POST', '/auth/logout', {
        refreshToken: mgrRefresh,
      }, mgrToken);
      log({
        name: 'Logout revokes tokens and sessions',
        endpoint: '/auth/logout',
        method: 'POST',
        status,
        passed: status === 200,
        duration,
      });

      // Verify token is blacklisted
      const { status: s2, duration: dur2 } = await apiCall('GET', '/devices/me', undefined, mgrToken);
      log({
        name: 'Blacklisted token rejected after logout',
        endpoint: '/devices/me',
        method: 'GET',
        status: s2,
        passed: s2 === 401,
        duration: dur2,
        error: s2 !== 401 ? `Expected 401, got ${s2}` : undefined,
      });
    }
  }

  // ─── SUMMARY ──────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const avgDuration = Math.round(results.reduce((s, r) => s + r.duration, 0) / total);

  console.log(`  Total:    ${total}`);
  console.log(`  Passed:   ${passed} ✅`);
  console.log(`  Failed:   ${failed} ❌`);
  console.log(`  Avg Time: ${avgDuration}ms`);
  console.log(`  Pass Rate: ${Math.round((passed / total) * 100)}%\n`);

  if (failed > 0) {
    console.log('  Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ ${r.name} (${r.method} ${r.endpoint}) — Status: ${r.status}`);
      if (r.error) console.log(`       ${r.error}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, avgDuration, passRate: `${Math.round((passed / total) * 100)}%` },
    tests: results,
  };

  const fs = require('fs');
  const path = require('path');
  const reportPath = path.join(process.cwd(), 'test-reports');
  if (!fs.existsSync(reportPath)) fs.mkdirSync(reportPath, { recursive: true });
  const fileName = `api-test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(reportPath, fileName), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportPath, 'latest-report.json'), JSON.stringify(report, null, 2));
  console.log(`  📄 Report saved to: test-reports/${fileName}\n`);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
