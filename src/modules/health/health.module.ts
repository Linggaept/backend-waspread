import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { WhatsAppHealthIndicator } from './whatsapp.health';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppSession } from '../../database/entities/whatsapp-session.entity';

@Module({
  imports: [
    TerminusModule,
    TypeOrmModule.forFeature([WhatsAppSession]),
    WhatsAppModule,
  ],
  controllers: [HealthController],
  providers: [WhatsAppHealthIndicator],
})
export class HealthModule {}
