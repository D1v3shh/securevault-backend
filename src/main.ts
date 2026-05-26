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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
        'Enterprise-grade secure file sharing platform API.\n\n' +
        'Features: Authentication, RBAC, Envelope Encryption, Audit Logging, File Management.',
      )
      .setVersion('1.0.0')
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
      .addTag('Authentication', 'Login, logout, token management')
      .addTag('Admin', 'User management (admin-only)')
      .addTag('Files', 'File upload, download, management')
      .addTag('Health', 'System health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
    });

    logger.log(`📄 Swagger docs available at /${prefix.replace('api/v1', '')}docs`);
  }

  // ─── Start Server ──────────────────────────────────
  const port = configService.get<number>('app.port', 3000);
  const host = configService.get<string>('app.host', '0.0.0.0');

  await app.listen(port, host);
  logger.log(`🚀 SecureVault API running on http://${host}:${port}/${prefix}`);
  logger.log(`📋 Environment: ${configService.get('app.env')}`);
}

bootstrap();
