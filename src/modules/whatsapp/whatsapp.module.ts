import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import { WhatsAppSession } from '../../database/entities/whatsapp-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsAppSession])],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppGateway],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
