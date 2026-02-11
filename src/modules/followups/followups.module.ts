import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { FollowupsController } from './followups.controller';
import { FollowupsService } from './followups.service';
import { FollowupSchedulerService } from './services/followup-scheduler.service';
import { ContactFollowupService } from './services/contact-followup.service';
import { FollowupProcessor } from './processors/followup.processor';
import { ContactFollowupProcessor } from './processors/contact-followup.processor';
import { FollowupCampaign } from '../../database/entities/followup-campaign.entity';
import { FollowupMessage } from '../../database/entities/followup-message.entity';
import { ContactFollowup } from '../../database/entities/contact-followup.entity';
import { Blast, BlastMessage } from '../../database/entities/blast.entity';
import { BlastReply } from '../../database/entities/blast-reply.entity';
import { ConversationFunnel } from '../../database/entities/conversation-funnel.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { ChatConversation } from '../../database/entities/chat-conversation.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FollowupCampaign,
      FollowupMessage,
      ContactFollowup,
      Blast,
      BlastMessage,
      BlastReply,
      ConversationFunnel,
      ChatMessage,
      ChatConversation,
    ]),
    BullModule.registerQueue(
      { name: 'followup' },
      { name: 'contact-followup' },
    ),
    ScheduleModule.forRoot(),
    forwardRef(() => WhatsAppModule),
    SubscriptionsModule,
  ],
  controllers: [FollowupsController],
  providers: [
    FollowupsService,
    ContactFollowupService,
    FollowupSchedulerService,
    FollowupProcessor,
    ContactFollowupProcessor,
  ],
  exports: [FollowupsService, ContactFollowupService],
})
export class FollowupsModule {}
