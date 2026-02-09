import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConversationFunnel } from '../../database/entities/conversation-funnel.entity';
import { AnalyticsSnapshot } from '../../database/entities/analytics-snapshot.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { LeadScore } from '../../database/entities/lead-score.entity';
import { Blast } from '../../database/entities/blast.entity';
import { Contact } from '../../database/entities/contact.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { FunnelTrackerService } from './services/funnel-tracker.service';
import { ClosingInsightService } from './services/closing-insight.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationFunnel,
      AnalyticsSnapshot,
      ChatMessage,
      LeadScore,
      Blast,
      Contact,
    ]),
    ScheduleModule.forRoot(),
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, FunnelTrackerService, ClosingInsightService],
  exports: [AnalyticsService, FunnelTrackerService, ClosingInsightService],
})
export class AnalyticsModule {}
