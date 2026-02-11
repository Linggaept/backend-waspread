import { Module } from '@nestjs/common';
import { CopywritingController } from './copywriting.controller';
import { CopywritingService } from './copywriting.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FeatureGuard, AiQuotaGuard } from '../auth/guards';

@Module({
  imports: [SubscriptionsModule],
  controllers: [CopywritingController],
  providers: [CopywritingService, FeatureGuard, AiQuotaGuard],
})
export class CopywritingModule {}
