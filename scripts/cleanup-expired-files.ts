/**
 * Permanently purge files that have been soft-deleted beyond the retention
 * period (30 days), removing both the encrypted blob and its metadata row.
 *
 * `FilesService.deleteFile` only soft-deletes, so without this the blobs
 * accumulate on disk forever. Nothing schedules it — there is no queue or cron
 * wired up (see PROJECT_CONTEXT.md technical debt), so run it deliberately.
 *
 * THIS IS IRREVERSIBLE. The metadata row holds the wrapped DEK, so once it is
 * gone the blob cannot be decrypted even if restored from a backup. Dry run is
 * the default; purging requires --confirm.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-expired-files.ts                  # dry run
 *   npx ts-node scripts/cleanup-expired-files.ts --limit=25       # dry run, 25 rows
 *   npx ts-node scripts/cleanup-expired-files.ts --confirm        # purge
 *   npx ts-node scripts/cleanup-expired-files.ts --confirm --performed-by=<userId>
 *
 * Every purge writes a `file.delete` audit entry with `event: permanent_delete`
 * before the row disappears.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import configModules from '../src/config/configuration';
import {
  FileEntity,
  FileSchema,
} from '../src/modules/files/schemas/file.schema';
import { StorageModule } from '../src/modules/storage/storage.module';
import { AuditModule } from '../src/modules/audit/audit.module';
import { FileProcessor } from '../src/modules/queue/processors/file.processor';

/**
 * Minimal module: just Mongo, storage and audit. Deliberately not AppModule —
 * booting that would also connect Vault and Redis and re-run the super admin
 * seed, none of which this task needs.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configModules }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('database.uri'),
        dbName: config.get<string>('database.dbName'),
      }),
    }),
    MongooseModule.forFeature([{ name: FileEntity.name, schema: FileSchema }]),
    StorageModule,
    AuditModule,
  ],
  providers: [FileProcessor],
})
class CleanupModule {}

function parseArgs(argv: string[]) {
  const confirm = argv.includes('--confirm');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const actorArg = argv.find((a) => a.startsWith('--performed-by='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  if (limitArg && (!limit || limit < 1)) {
    throw new Error(`Invalid --limit value: ${limitArg.split('=')[1]}`);
  }

  return {
    dryRun: !confirm,
    limit,
    performedBy: actorArg ? actorArg.split('=')[1] : undefined,
  };
}

async function main(): Promise<void> {
  const { dryRun, limit, performedBy } = parseArgs(process.argv.slice(2));

  console.log(
    `\n🧹 Expired file cleanup — ${dryRun ? 'DRY RUN (no changes)' : 'PURGING'}\n`,
  );

  const app = await NestFactory.createApplicationContext(CleanupModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const processor = app.get(FileProcessor);
    const result = await processor.cleanupExpiredFiles({
      dryRun,
      limit,
      performedBy,
    });

    console.log('\n─── Result ───');
    console.log(`  mode:    ${result.dryRun ? 'dry run' : 'purge'}`);
    console.log(`  scanned: ${result.scanned}`);
    console.log(`  deleted: ${result.deleted}`);
    console.log(`  errors:  ${result.errors}`);
    if (result.uuids.length) {
      console.log(
        `  files:   ${result.uuids.slice(0, 20).join(', ')}` +
          (result.uuids.length > 20
            ? ` … and ${result.uuids.length - 20} more`
            : ''),
      );
    }

    if (result.dryRun && result.scanned > 0) {
      console.log('\nRe-run with --confirm to purge these files permanently.');
    }
    console.log('');

    if (result.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: any) => {
  console.error(`\n❌ Cleanup failed: ${error?.message}\n`);
  process.exit(1);
});
