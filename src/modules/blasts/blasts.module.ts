import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BlastsService } from './blasts.service';
import { BlastsController } from './blasts.controller';
import { BlastProcessor } from './processors/blast.processor';
import { Blast, BlastMessage } from '../../database/entities/blast.entity';
import { BlastReply } from '../../database/entities/blast-reply.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UploadsModule } from '../uploads';
import { ContactsModule } from '../contacts/contacts.module';
import { TemplatesModule } from '../templates/templates.module';
import { ReplyDetectionService } from './services/reply-detection.service';
import { BlastRepliesService } from './services/blast-replies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Blast, BlastMessage, BlastReply]),
    BullModule.registerQueue({
      name: 'blast',
    }),
    WhatsAppModule,
    SubscriptionsModule,
    UploadsModule,
    ContactsModule,
    TemplatesModule,
  ],
  controllers: [BlastsController],
  providers: [BlastsService, BlastProcessor, ReplyDetectionService, BlastRepliesService],
  exports: [BlastsService, ReplyDetectionService],
})
export class BlastsModule implements OnModuleInit {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly replyDetectionService: ReplyDetectionService,
  ) {}

  onModuleInit() {
    // Register reply handler with WhatsApp service
    this.whatsAppService.setReplyHandler(this.replyDetectionService);
  }
}
