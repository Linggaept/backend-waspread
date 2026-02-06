import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { PinnedConversation } from '../../database/entities/pinned-conversation.entity';
import { Contact } from '../../database/entities/contact.entity';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { UploadsModule } from '../uploads/uploads.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadsService } from '../leads/leads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, BlastMessage, PinnedConversation, Contact]),
    WhatsAppModule,
    UploadsModule,
    forwardRef(() => LeadsModule),
    MulterModule.register({
      storage: diskStorage({
        destination: path.join(process.cwd(), 'uploads', 'temp'),
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = path.extname(file.originalname);
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
    }),
  ],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule implements OnModuleInit {
  private readonly logger = new Logger(ChatsModule.name);

  constructor(
    private readonly chatsService: ChatsService,
    private readonly whatsAppService: WhatsAppService,
    private readonly whatsAppGateway: WhatsAppGateway,
    private readonly leadsService: LeadsService,
  ) {}

  onModuleInit() {
    this.whatsAppService.setMessageStoreHandler({
      handleMessageUpsert: async (userId, message) => {
        await this.chatsService.handleMessageUpsert(userId, message);

        // Trigger lead score update (fire and forget)
        const phoneNumber = message.from?.replace(/@(c\.us|s\.whatsapp\.net)$/, '');
        if (phoneNumber) {
          this.leadsService.handleNewMessage(userId, phoneNumber).catch((err) => {
            this.logger.error(`Failed to update lead score: ${err}`);
          });
        }
      },
    });

    this.whatsAppService.setMessageStatusHandler({
      handleMessageStatusUpdate: (userId, messageId, phoneNumber, status) =>
        this.chatsService.handleMessageStatusUpdate(userId, messageId, phoneNumber, status),
    });

    this.whatsAppGateway.setChatService(this.chatsService);
  }
}
