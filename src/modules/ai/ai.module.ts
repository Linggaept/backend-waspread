import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { BullModule } from '@nestjs/bullmq';
import { diskStorage } from 'multer';
import * as path from 'path';
import { AiController } from './ai.controller';
import { AiTokenController } from './controllers/ai-token.controller';
import { AiService } from './ai.service';
import { AutoReplyService } from './services/auto-reply.service';
import { AiTokenService } from './services/ai-token.service';
import { AutoReplyProcessor } from './processors/auto-reply.processor';
import { AiKnowledgeBase } from '../../database/entities/ai-knowledge-base.entity';
import { AiSettings } from '../../database/entities/ai-settings.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { AutoReplyBlacklist } from '../../database/entities/auto-reply-blacklist.entity';
import { AutoReplyLog } from '../../database/entities/auto-reply-log.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { User } from '../../database/entities/user.entity';
import { AiTokenPackage } from '../../database/entities/ai-token-package.entity';
import { AiTokenPurchase } from '../../database/entities/ai-token-purchase.entity';
import { AiTokenUsage } from '../../database/entities/ai-token-usage.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ChatsModule } from '../chats/chats.module';
import { FeatureGuard, RolesGuard } from '../auth/guards';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiKnowledgeBase,
      AiSettings,
      ChatMessage,
      AutoReplyBlacklist,
      AutoReplyLog,
      BlastMessage,
      User,
      AiTokenPackage,
      AiTokenPurchase,
      AiTokenUsage,
    ]),
    BullModule.registerQueue({
      name: 'auto-reply',
    }),
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => WhatsAppModule),
    forwardRef(() => ChatsModule),
    MulterModule.register({
      storage: diskStorage({
        destination: path.join(process.cwd(), 'uploads', 'temp'),
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = path.extname(file.originalname);
          cb(null, `kb-import-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
      },
    }),
  ],
  controllers: [AiController, AiTokenController],
  providers: [
    AiService,
    AutoReplyService,
    AiTokenService,
    AutoReplyProcessor,
    FeatureGuard,
    RolesGuard,
  ],
  exports: [AiService, AutoReplyService, AiTokenService],
})
export class AiModule {}
