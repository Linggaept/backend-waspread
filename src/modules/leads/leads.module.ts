import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadScore } from '../../database/entities/lead-score.entity';
import { LeadScoreSettings } from '../../database/entities/lead-score-settings.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadScore, LeadScoreSettings, ChatMessage]),
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
