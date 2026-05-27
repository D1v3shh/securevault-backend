import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);

  // ─── Global Prefix ──────────────────────────────────
  const prefix = configService.get<string>('app.apiPrefix', 'api/v1');
  app.setGlobalPrefix(prefix);

  // ─── Security ───────────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

  // ─── CORS ───────────────────────────────────────────
  const corsOrigins = configService.get<string[]>('app.corsOrigins', ['http://localhost:3000']);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Fingerprint'],
  });

  // ─── Global Pipes ──────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: configService.get('app.env') === 'production',
    }),
  );

  // ─── Global Filters ────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Global Interceptors ───────────────────────────
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ─── Swagger / OpenAPI ──────────────────────────────
  if (configService.get('app.env') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SecureVault API')
      .setDescription(
        '## SecureVault — Enterprise-Grade Secure Backend\n\n' +
        'Centralized backend supporting device onboarding, certificate-based authentication, ' +
        'and secure API access for desktop applications.\n\n' +
        '### Core Features\n' +
        '- **Device Enrollment** — SetupApp onboarding via enrollment tokens\n' +
        '- **PKI Certificate Management** — X.509 certificate signing via HashiCorp Vault PKI\n' +
        '- **Passwordless Authentication** — Certificate-based login for Main SecureVault App\n' +
        '- **Device Trust Management** — Fingerprint-based device approval workflow\n' +
        '- **JWT Session Management** — Access/refresh token issuance with rotation\n' +
        '- **RBAC** — Role-based authorization (Super Admin, Admin, Manager, Employee)\n' +
        '- **Audit Logging** — Immutable audit trail for all security events\n\n' +
        '### Applications\n' +
        '| App | Purpose |\n' +
        '|---|---|\n' +
        '| **SetupApp** | Device enrollment & certificate installation |\n' +
        '| **Main SecureVault** | Daily secure operations with certificate auth |\n',
      )
      .setVersion('2.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT access token',
          in: 'header',
        },
        'access-token',
      )
      .addTag('Setup', 'Device enrollment & onboarding (SetupApp)')
      .addTag('Authentication', 'Login, logout, token management')
      .addTag('Certificates', 'X.509 certificate verification & revocation')
      .addTag('Devices', 'Device trust management')
      .addTag('Admin', 'User management, enrollment tokens, audit logs')
      .addTag('Health', 'System health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'SecureVault API Documentation',
    });

    logger.log(`📄 Swagger docs available at /api/docs`);
  }

  // ─── Start Server ──────────────────────────────────
  const port = configService.get<number>('app.port', 3000);
  const host = configService.get<string>('app.host', '0.0.0.0');

  await app.listen(port, host);
  logger.log(`🚀 SecureVault API running on http://${host}:${port}/${prefix}`);
  logger.log(`📋 Environment: ${configService.get('app.env')}`);
}

bootstrap();
