import { Module, forwardRef } from '@nestjs/common';
import { CopywritingController } from './copywriting.controller';
import { CopywritingService } from './copywriting.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FeatureGuard } from '../auth/guards';

@Module({
  imports: [forwardRef(() => AiModule), SubscriptionsModule],
  controllers: [CopywritingController],
  providers: [CopywritingService, FeatureGuard],
})
export class CopywritingModule {}
