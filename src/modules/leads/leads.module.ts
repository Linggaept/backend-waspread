import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { LeadsProcessor } from './leads.processor';
import { LeadScore } from '../../database/entities/lead-score.entity';
import { LeadScoreSettings } from '../../database/entities/lead-score-settings.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FeatureGuard } from '../auth/guards';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadScore, LeadScoreSettings, ChatMessage]),
    forwardRef(() => WhatsAppModule),
    SubscriptionsModule,
    BullModule.registerQueue({
      name: 'leads',
    }),
  ],
  controllers: [LeadsController],
  providers: [LeadsService, LeadsProcessor, FeatureGuard],
  exports: [LeadsService],
})
export class LeadsModule {}
