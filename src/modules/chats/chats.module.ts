import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { ChatConversation } from '../../database/entities/chat-conversation.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { PinnedConversation } from '../../database/entities/pinned-conversation.entity';
import { Contact } from '../../database/entities/contact.entity';
import { ContactFollowup } from '../../database/entities/contact-followup.entity';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { UploadsModule } from '../uploads/uploads.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadsService } from '../leads/leads.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { FunnelTrackerService } from '../analytics/services/funnel-tracker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatMessage,
      BlastMessage,
      PinnedConversation,
      Contact,
      ChatConversation,
      ContactFollowup,
    ]),
    WhatsAppModule,
    UploadsModule,
    forwardRef(() => LeadsModule),
    forwardRef(() => AnalyticsModule),
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
    private readonly funnelTrackerService: FunnelTrackerService,
  ) {}

  onModuleInit() {
    this.whatsAppService.setMessageStoreHandler({
      handleMessageUpsert: async (userId, message) => {
        await this.chatsService.handleMessageUpsert(userId, message);

        const phoneNumber = message.from?.replace(
          /@(c\.us|s\.whatsapp\.net)$/,
          '',
        );
        if (phoneNumber) {
          // Trigger lead score update (fire and forget)
          this.leadsService
            .handleNewMessage(userId, phoneNumber)
            .catch((err) => {
              this.logger.error(`Failed to update lead score: ${err}`);
            });

          // Trigger funnel tracking for incoming messages (fire and forget)
          if (!message.fromMe && message.body) {
            this.funnelTrackerService
              .onMessageReceived(userId, phoneNumber, message.body)
              .catch((err) => {
                this.logger.error(`Failed to update funnel: ${err}`);
              });
          }
        }
      },
    });

    this.whatsAppService.setMessageStatusHandler({
      handleMessageStatusUpdate: async (
        userId,
        messageId,
        phoneNumber,
        status,
      ) => {
        await this.chatsService.handleMessageStatusUpdate(
          userId,
          messageId,
          phoneNumber,
          status,
        );

        // Update funnel on delivery (fire and forget)
        if (status === 'delivered' && phoneNumber) {
          this.funnelTrackerService
            .onMessageDelivered(userId, phoneNumber)
            .catch((err) => {
              this.logger.error(`Failed to update funnel delivery: ${err}`);
            });
        }
      },
    });

    this.whatsAppGateway.setChatService(this.chatsService);
  }
}
