import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 3000;
  const nodeEnv = configService.get<string>('app.nodeEnv') || 'development';

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:2004',
      'https://waspread.vercel.app',
      'https://waspread.com',
      'https://api.netadev.my.id',
      'https://www.netadev.my.id',
      'https://pub-33094a992e3c43afbf4383b7bf01bcbd.r2.dev',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('WhatsApp Blasting SaaS API')
    .setDescription(
      `
## WhatsApp Blasting SaaS Backend API

A complete API for managing WhatsApp message blasting with subscription-based pricing.

### Features:
- 🔐 **Authentication** - JWT-based auth with role-based access control
- 📦 **Packages** - Subscription package management
- 💳 **Payments** - Midtrans payment integration
- 📱 **WhatsApp** - Session management with QR code login
- 📨 **Blasts** - Bulk message sending with queue processing
- 📊 **Reports** - Dashboard statistics and CSV exports
- ❤️ **Health** - System health monitoring

### Authentication
Most endpoints require JWT authentication. Use the \`/api/auth/login\` endpoint to get a token, then include it in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <your-token>
\`\`\`
    `,
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Users', 'User management (Admin)')
    .addTag('Packages', 'Subscription packages')
    .addTag('Payments', 'Payment processing with Midtrans')
    .addTag('Subscriptions', 'User subscription management')
    .addTag('WhatsApp', 'WhatsApp session management')
    .addTag('Blasts', 'Message blasting campaigns')
    .addTag('Reports', 'Dashboard and reporting')
    .addTag('Health', 'System health checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'WhatsApp Blasting API Docs',
  });

  // Shutdown hooks
  app.enableShutdownHooks();

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
  logger.log(`📝 Environment: ${nodeEnv}`);
  logger.log(`📚 API Docs: http://localhost:${port}/docs`);
  logger.log(`❤️  Health check: http://localhost:${port}/api/health`);
}
bootstrap();
