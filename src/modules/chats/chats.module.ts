import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { PinnedConversation } from '../../database/entities/pinned-conversation.entity';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, BlastMessage, PinnedConversation]),
    WhatsAppModule,
  ],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule implements OnModuleInit {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly whatsAppService: WhatsAppService,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) {}

  onModuleInit() {
    this.whatsAppService.setMessageStoreHandler({
      handleMessageUpsert: (userId, message) =>
        this.chatsService.handleMessageUpsert(userId, message),
    });

    this.whatsAppGateway.setChatService(this.chatsService);
  }
}
