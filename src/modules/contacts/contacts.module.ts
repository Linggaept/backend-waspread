import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { Contact } from '../../database/entities/contact.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { WhatsAppSession } from '../../database/entities/whatsapp-session.entity';
import { UploadsModule } from '../uploads';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, ChatMessage, WhatsAppSession]),
    UploadsModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
