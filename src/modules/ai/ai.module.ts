import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiKnowledgeBase } from '../../database/entities/ai-knowledge-base.entity';
import { AiSettings } from '../../database/entities/ai-settings.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FeatureGuard, AiQuotaGuard } from '../auth/guards';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiKnowledgeBase, AiSettings, ChatMessage]),
    SubscriptionsModule,
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
  controllers: [AiController],
  providers: [AiService, FeatureGuard, AiQuotaGuard],
  exports: [AiService],
})
export class AiModule {}
