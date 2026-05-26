import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import * as path from 'path';

/**
 * Enterprise-grade Winston-based logger service.
 * Implements NestJS LoggerService interface for seamless integration.
 * Structured JSON logging in production, colorized console in development.
 */
@Injectable()
export class AppLoggerService implements NestLoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const logDir = process.env.LOG_DIR || './logs';
    const logLevel = process.env.LOG_LEVEL || 'debug';
    const isProduction = process.env.NODE_ENV === 'production';

    const formats = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
    ];

    // JSON format for production, colorized for dev
    const consoleFormat = isProduction
      ? winston.format.combine(...formats, winston.format.json())
      : winston.format.combine(
          ...formats,
          winston.format.colorize({ all: true }),
          winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
            const ctx = context ? `[${context}]` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            const traceStr = trace ? `\n${trace}` : '';
            return `${timestamp} ${level} ${ctx} ${message}${metaStr}${traceStr}`;
          }),
        );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: consoleFormat,
        level: logLevel,
      }),
    ];

    // File transports for production
    if (isProduction) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          format: winston.format.combine(...formats, winston.format.json()),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 10,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          format: winston.format.combine(...formats, winston.format.json()),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 20,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'audit.log'),
          level: 'info',
          format: winston.format.combine(...formats, winston.format.json()),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 30,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      defaultMeta: { service: process.env.APP_NAME || 'SecureVault' },
      transports,
      exitOnError: false,
    });
  }

  log(message: string, context?: string): void {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(message, { context });
  }

  /**
   * Log an audit event with structured metadata.
   */
  audit(action: string, metadata: Record<string, any>, context?: string): void {
    this.logger.info(`AUDIT: ${action}`, { ...metadata, context, audit: true });
  }
}
