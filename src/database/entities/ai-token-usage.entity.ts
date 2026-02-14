import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum AiFeatureType {
  AUTO_REPLY = 'auto_reply',
  AUTO_REPLY_IMAGE = 'auto_reply_image', // Auto-reply with vision (image analysis)
  SUGGEST = 'suggest',
  COPYWRITING = 'copywriting',
  KNOWLEDGE_IMPORT = 'knowledge_import',
  ANALYTICS = 'analytics',
}

// Token cost per feature (variable pricing)
export const AI_FEATURE_TOKEN_COST: Record<AiFeatureType, number> = {
  [AiFeatureType.SUGGEST]: 1, // Simple, quick response
  [AiFeatureType.AUTO_REPLY]: 1, // Text-only auto-reply
  [AiFeatureType.AUTO_REPLY_IMAGE]: 3, // Auto-reply with image analysis (vision)
  [AiFeatureType.COPYWRITING]: 2, // Multiple variations generated
  [AiFeatureType.KNOWLEDGE_IMPORT]: 5, // Heavy processing (PDF/image)
  [AiFeatureType.ANALYTICS]: 3, // Conversation analysis
};

@Entity('ai_token_usage')
@Index(['userId', 'createdAt'])
@Index(['userId', 'feature'])
export class AiTokenUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: AiFeatureType,
  })
  feature: AiFeatureType;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0.01 })
  tokensUsed: number;

  @Column({ type: 'varchar', nullable: true })
  referenceId: string | null; // e.g., auto-reply log ID, chat message ID

  @Column({ type: 'text', nullable: true })
  metadata: string | null; // JSON string for extra info

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
