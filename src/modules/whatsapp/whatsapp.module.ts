import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import { WhatsAppSession } from '../../database/entities/whatsapp-session.entity';
import { Notification } from '../../database/entities/notification.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsAppSession, Notification]),
    UploadsModule,
    ContactsModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppGateway],
  exports: [WhatsAppService, WhatsAppGateway],
})
export class WhatsAppModule {}

