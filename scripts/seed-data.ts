/**
 * Seed script — creates sample data for development/testing.
 *
 * Usage: npx ts-node scripts/seed-data.ts
 *
 * Prerequisites:
 *   - MongoDB running (docker-compose up -d mongodb)
 *   - .env configured
 */

import * as crypto from 'crypto';

const MONGO_URI = process.env.MONGODB_URI ||
  'mongodb://securevault_user:securevault_pass_dev@localhost:27017/securevault?authSource=admin';

async function seedData() {
  const { MongoClient } = require('mongodb');
  const bcrypt = require('bcrypt');

  console.log('\n🌱 Seeding SecureVault development data...\n');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('securevault');

  // 1. Seed users
  console.log('1️⃣  Seeding users...');
  const users = [
    {
      uuid: crypto.randomUUID(),
      email: 'admin@securevault.local',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isActive: true,
      isFirstLogin: false,
      mustChangePassword: false,
      createdBy: 'system:seed',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      uuid: crypto.randomUUID(),
      email: 'manager@securevault.local',
      passwordHash: await bcrypt.hash('Manager@123', 12),
      firstName: 'Manager',
      lastName: 'User',
      role: 'MANAGER',
      isActive: true,
      isFirstLogin: false,
      mustChangePassword: false,
      createdBy: 'system:seed',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      uuid: crypto.randomUUID(),
      email: 'employee@securevault.local',
      passwordHash: await bcrypt.hash('Employee@123', 12),
      firstName: 'John',
      lastName: 'Employee',
      role: 'EMPLOYEE',
      isActive: true,
      isFirstLogin: true,
      mustChangePassword: true,
      department: 'Engineering',
      jobTitle: 'Software Engineer',
      createdBy: 'system:seed',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  for (const user of users) {
    const exists = await db.collection('users').findOne({ email: user.email });
    if (!exists) {
      await db.collection('users').insertOne(user);
      console.log(`   ✅ Created user: ${user.email} (${user.role})`);
    } else {
      console.log(`   ⏭️  User exists: ${user.email}`);
    }
  }

  // 2. Get employee user for enrollment token
  const employee = await db.collection('users').findOne({ email: 'employee@securevault.local' });

  if (employee) {
    // 3. Seed enrollment token
    console.log('\n2️⃣  Seeding enrollment token...');
    const tokenValue = `enr_${crypto.randomBytes(32).toString('hex')}`;
    const tokenExists = await db.collection('enrollment_tokens').findOne({ employeeId: 'EMP-001', isUsed: false });

    if (!tokenExists) {
      await db.collection('enrollment_tokens').insertOne({
        uuid: crypto.randomUUID(),
        token: tokenValue,
        userId: employee._id,
        employeeId: 'EMP-001',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        isUsed: false,
        usedCount: 0,
        maxDevices: 2,
        createdBy: 'system:seed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Enrollment token: ${tokenValue}`);
      console.log(`   📋 Employee ID: EMP-001`);
    } else {
      console.log(`   ⏭️  Enrollment token exists for EMP-001`);
    }
  }

  // 4. Seed a sample device
  console.log('\n3️⃣  Seeding sample device...');
  const deviceFingerprint = crypto.createHash('sha256')
    .update('WORKSTATION-001|00:1A:2B:3C:4D:5E|SN-SEED001|win32|x64')
    .digest('hex');

  const deviceExists = await db.collection('devices').findOne({ fingerprint: deviceFingerprint });
  if (!deviceExists && employee) {
    await db.collection('devices').insertOne({
      deviceId: crypto.randomUUID(),
      userId: employee._id,
      employeeId: 'EMP-001',
      fingerprint: deviceFingerprint,
      hostname: 'WORKSTATION-SEED',
      platform: 'win32',
      arch: 'x64',
      osVersion: 'Windows 11 Pro',
      macAddress: '00:1A:2B:3C:4D:5E',
      serialNumber: 'SN-SEED001',
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: 'system:seed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`   ✅ Sample device created (fingerprint: ${deviceFingerprint.substring(0, 16)}...)`);
  } else {
    console.log('   ⏭️  Sample device exists');
  }

  console.log('\n✅ Seed data complete!\n');
  console.log('Test Credentials:');
  console.log('  Admin:    admin@securevault.local / Admin@123');
  console.log('  Manager:  manager@securevault.local / Manager@123');
  console.log('  Employee: employee@securevault.local / Employee@123');
  console.log('');

  await client.close();
}

seedData().catch(console.error);
