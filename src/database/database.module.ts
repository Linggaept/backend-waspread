import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { Package } from './entities/package.entity';
import { Payment } from './entities/payment.entity';
import { Subscription } from './entities/subscription.entity';
import { WhatsAppSession } from './entities/whatsapp-session.entity';
import { Blast, BlastMessage } from './entities/blast.entity';
import { BlastReply } from './entities/blast-reply.entity';
import { Contact } from './entities/contact.entity';
import { Template } from './entities/template.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Notification } from './entities/notification.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { PinnedConversation } from './entities/pinned-conversation.entity';
import { UserSettings } from './entities/user-settings.entity';
import { AiKnowledgeBase } from './entities/ai-knowledge-base.entity';
import { AiSettings } from './entities/ai-settings.entity';
import { LeadScore } from './entities/lead-score.entity';
import { LeadScoreSettings } from './entities/lead-score-settings.entity';
import { ConversationFunnel } from './entities/conversation-funnel.entity';
import { AnalyticsSnapshot } from './entities/analytics-snapshot.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { Product } from './entities/product.entity';
import { FollowupCampaign } from './entities/followup-campaign.entity';
import { FollowupMessage } from './entities/followup-message.entity';
import { ContactFollowup } from './entities/contact-followup.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('app.nodeEnv');
        const isProduction = nodeEnv === 'production';
        const useSsl = configService.get<string>('database.ssl') === 'true';

        return {
          type: 'postgres',
          host: configService.get<string>('database.host'),
          port: configService.get<number>('database.port'),
          username: configService.get<string>('database.username'),
          password: configService.get<string>('database.password'),
          database: configService.get<string>('database.database'),
          ssl: useSsl ? { rejectUnauthorized: false } : false,
          entities: [
            User,
            Package,
            Payment,
            Subscription,
            WhatsAppSession,
            Blast,
            BlastMessage,
            BlastReply,
            Contact,
            Template,
            PasswordReset,
            AuditLog,
            Notification,
            ChatMessage,
            PinnedConversation,
            UserSettings,
            AiKnowledgeBase,
            AiSettings,
            LeadScore,
            LeadScoreSettings,
            ConversationFunnel,
            AnalyticsSnapshot,
            ChatConversation,
            Product,
            FollowupCampaign,
            FollowupMessage,
            ContactFollowup,
          ],
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          // IMPORTANT: synchronize is disabled in production to prevent data loss
          synchronize: isProduction,
          logging: !isProduction,
          extra: {
            timezone: 'UTC',
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
