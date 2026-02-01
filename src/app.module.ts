import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
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
import { databaseConfig, redisConfig, appConfig, midtransConfig } from './config';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, appConfig, midtransConfig],
      envFilePath: ['.env'],
    }),

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
