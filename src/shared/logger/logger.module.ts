import { Global, Module } from '@nestjs/common';
import { AppLoggerService } from './logger.service';

/**
 * Provides the winston-backed application logger.
 *
 * `main.ts` pulls AppLoggerService out of the container and hands it to
 * `app.useLogger()`, which is what makes `bufferLogs: true` and the LOG_LEVEL /
 * LOG_DIR environment variables take effect. Global so services can also inject
 * it directly when they need structured metadata rather than plain messages.
 */
@Global()
@Module({
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class LoggerModule {}
