import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Blast } from './blast.entity';

export enum FunnelStage {
  BLAST_SENT = 'blast_sent',
  DELIVERED = 'delivered',
  REPLIED = 'replied',
  INTERESTED = 'interested',
  NEGOTIATING = 'negotiating',
  CLOSED_WON = 'closed_won',
  CLOSED_LOST = 'closed_lost',
}

export interface StageHistoryEntry {
  stage: FunnelStage;
  enteredAt: Date;
  trigger: string; // 'auto' | 'manual' | 'keyword:beli' | etc
}

export interface SuccessFactor {
  factor: string;
  description: string;
  evidence: string;
}

export interface FailureFactor {
  factor: string;
  description: string;
  evidence: string;
}

export interface ImprovementArea {
  area: string;
  suggestion: string;
}

export interface KeyMoment {
  timestamp: Date;
  event: string;
}

export interface AiInsight {
  summary: string;
  successFactors?: SuccessFactor[];
  failureFactors?: FailureFactor[];
  improvementAreas?: ImprovementArea[];
  missedOpportunities?: string[];
  keyMoments?: KeyMoment[];
  recommendations?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  recoveryChance?: 'high' | 'medium' | 'low';
  recoverySuggestion?: string;
  analyzedAt?: Date;
}

@Entity('conversation_funnels')
@Index(['userId', 'currentStage'])
@Index(['userId', 'blastId'])
@Index(['userId', 'phoneNumber'], { unique: true })
export class ConversationFunnel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  @Index()
  phoneNumber: string;

  @Column({
    type: 'enum',
    enum: FunnelStage,
    default: FunnelStage.BLAST_SENT,
  })
  currentStage: FunnelStage;

  @Column({ type: 'jsonb', default: [] })
  stageHistory: StageHistoryEntry[];

  // Source tracking
  @Column('uuid', { nullable: true })
  blastId: string | null;

  @ManyToOne(() => Blast, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'blastId' })
  blast: Blast;

  @Column({ type: 'varchar', nullable: true })
  blastName: string | null;

  // Timestamps per stage
  @Column({ type: 'timestamp', nullable: true })
  blastSentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  repliedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  interestedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  negotiatingAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  // Revenue tracking
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  dealValue: number | null;

  @Column({ type: 'varchar', nullable: true })
  closedReason: string | null;

  // AI Insight
  @Column({ type: 'jsonb', nullable: true })
  aiInsight: AiInsight | null;

  @Column({ type: 'boolean', default: false })
  isAnalyzed: boolean;

  // Contact info cache
  @Column({ type: 'varchar', nullable: true })
  contactName: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
