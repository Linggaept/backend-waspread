import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { BlastsModule } from './modules/blasts/blasts.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HealthModule } from './modules/health/health.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CopywritingModule } from './modules/copywriting/copywriting.module';
import { ChatsModule } from './modules/chats/chats.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AiModule } from './modules/ai/ai.module';
import { LeadsModule } from './modules/leads/leads.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import {
  databaseConfig,
  redisConfig,
  appConfig,
  midtransConfig,
  mailConfig,
  geminiConfig,
} from './config';
import { validate } from './config/env.validation';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        redisConfig,
        appConfig,
        midtransConfig,
        mailConfig,
        geminiConfig,
      ],
      envFilePath: ['.env'],
      validate,
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Serve static files (uploads)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // Database connection
    DatabaseModule,

    // Queue system
    QueueModule,

    // Feature modules
    AuthModule,
    UsersModule,
    PackagesModule,
    PaymentsModule,
    SubscriptionsModule,
    WhatsAppModule,
    BlastsModule,
    ReportsModule,
    HealthModule,
    ContactsModule,
    TemplatesModule,
    AuditModule,
    NotificationsModule,
    CopywritingModule,
    ChatsModule,
    SettingsModule,
    AiModule,
    LeadsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
