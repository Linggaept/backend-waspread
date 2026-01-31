import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BlastsService } from './blasts.service';
import { BlastsController } from './blasts.controller';
import { BlastProcessor } from './processors/blast.processor';
import { Blast, BlastMessage } from '../../database/entities/blast.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Blast, BlastMessage]),
    BullModule.registerQueue({
      name: 'blast',
    }),
    WhatsAppModule,
    SubscriptionsModule,
  ],
  controllers: [BlastsController],
  providers: [BlastsService, BlastProcessor],
  exports: [BlastsService],
})
export class BlastsModule {}
