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
          winston.format.printf(
            ({ timestamp, level, message, context, trace, ...meta }) => {
              const ctx = context ? `[${context}]` : '';
              const metaStr = Object.keys(meta).length
                ? ` ${JSON.stringify(meta)}`
                : '';
              const traceStr = trace ? `\n${trace}` : '';
              return `${timestamp} ${level} ${ctx} ${message}${metaStr}${traceStr}`;
            },
          ),
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
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      defaultMeta: { service: process.env.APP_NAME || 'SecureVault' },
      transports,
      exitOnError: false,
    });
  }

  // Nest calls loggers as `method(message, ...optionalParams)`, where the
  // trailing params carry the context and — for error/fatal — a stack trace.
  // Fixed (message, trace, context) signatures mis-file the context as a stack
  // whenever Nest passes only (message, context), which is the common case.

  log(message: unknown, ...optionalParams: unknown[]): void {
    const { context } = this.splitParams(optionalParams);
    this.logger.info(this.asText(message), { context });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { context, stack } = this.splitParams(optionalParams);
    this.logger.error(this.asText(message), { context, trace: stack });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const { context } = this.splitParams(optionalParams);
    this.logger.warn(this.asText(message), { context });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const { context } = this.splitParams(optionalParams);
    this.logger.debug(this.asText(message), { context });
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const { context } = this.splitParams(optionalParams);
    this.logger.verbose(this.asText(message), { context });
  }

  /**
   * Nest 11 calls this for unrecoverable errors. Winston's npm levels have no
   * `fatal`, so it is recorded at `error` with a flag rather than dropped —
   * which is what happened before, since the method did not exist.
   */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const { context, stack } = this.splitParams(optionalParams);
    this.logger.error(this.asText(message), {
      context,
      trace: stack,
      fatal: true,
    });
  }

  /**
   * Split Nest's trailing params into context and stack trace.
   *
   * With one param it is the context, unless it spans multiple lines — that is
   * a stack. With two or more, Nest's own convention applies: the last is the
   * context and the one before it the stack.
   */
  private splitParams(params: unknown[]): { context?: string; stack?: string } {
    if (params.length === 0) {
      return {};
    }

    if (params.length === 1) {
      const only = this.asText(params[0]);
      return only.includes('\n') ? { stack: only } : { context: only };
    }

    const last = params[params.length - 1];
    const beforeLast = params[params.length - 2];

    return {
      context: last === undefined ? undefined : this.asText(last),
      stack: beforeLast === undefined ? undefined : this.asText(beforeLast),
    };
  }

  private asText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
