/**
 * Backfill `certificates.serialNumberNormalized`.
 *
 * `CertificatesService.verifyCertificate` looks a certificate up by its
 * normalized serial when the exact-serial match misses. That lookup is now a
 * single indexed query on `serialNumberNormalized`, so rows written before the
 * column existed need populating once.
 *
 * Safe to re-run: it recomputes the value for every row, so it also repairs
 * drift, and it creates the supporting index if it is missing.
 *
 * Usage:
 *   npx ts-node scripts/backfill-certificate-serials.ts
 *
 * Reads MONGODB_URI from the environment (or .env when dotenv is available).
 */
import mongoose from 'mongoose';

const COLLECTION = 'certificates';
const INDEX_KEY = { serialNumberNormalized: 1 } as const;

function loadEnvFile(): void {
  try {
    // dotenv ships with @nestjs/config; ignore it if it cannot be resolved.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('dotenv') as { config: () => void }).config();
  } catch {
    // Fall back to whatever is already in process.env
  }
}

async function backfill(): Promise<void> {
  loadEnvFile();

  const uri =
    process.env.MONGODB_URI ||
    'mongodb://localhost:27017/securevault?authSource=admin';

  console.log(`\n🔧 Backfilling ${COLLECTION}.serialNumberNormalized\n`);

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection(COLLECTION);

  const total = await collection.countDocuments({});
  const missingBefore = await collection.countDocuments({
    $or: [
      { serialNumberNormalized: { $exists: false } },
      { serialNumberNormalized: null },
    ],
  });

  console.log(
    `1️⃣  ${total} certificate(s), ${missingBefore} without the column`,
  );

  // Server-side derivation: strip ':' separators and lower-case, mirroring
  // CertificateUtil.normalizeSerialNumber.
  const result = await collection.updateMany(
    { serialNumber: { $type: 'string' } },
    [
      {
        $set: {
          serialNumberNormalized: {
            $toLower: {
              $replaceAll: {
                input: '$serialNumber',
                find: ':',
                replacement: '',
              },
            },
          },
        },
      },
    ],
  );

  console.log(
    `2️⃣  ${result.matchedCount} matched, ${result.modifiedCount} updated`,
  );

  await collection.createIndex(INDEX_KEY, {
    name: 'serialNumberNormalized_1',
  });
  console.log('3️⃣  Index serialNumberNormalized_1 ensured');

  const missingAfter = await collection.countDocuments({
    $or: [
      { serialNumberNormalized: { $exists: false } },
      { serialNumberNormalized: null },
    ],
  });

  if (missingAfter > 0) {
    console.warn(
      `\n⚠️  ${missingAfter} row(s) still have no normalized serial ` +
        `(missing or non-string serialNumber) — inspect these manually.`,
    );
  }

  console.log(
    `\n🎉 Backfill complete. Remaining without value: ${missingAfter}\n`,
  );

  await mongoose.disconnect();
}

backfill().catch(async (error: any) => {
  console.error(`\n❌ Backfill failed: ${error?.message}\n`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
