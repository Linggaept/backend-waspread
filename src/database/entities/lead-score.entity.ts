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

export enum LeadScoreLevel {
  HOT = 'hot',
  WARM = 'warm',
  COLD = 'cold',
}

export interface ScoreBreakdown {
  keyword: number;
  responseTime: number;
  engagement: number;
  recency: number;
  total: number;
}

export interface ScoreFactor {
  factor: string;
  description: string;
  points: number;
}

@Entity('lead_scores')
@Index(['userId', 'score'])
@Index(['userId', 'lastInteraction'])
export class LeadScore {
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
    enum: LeadScoreLevel,
    default: LeadScoreLevel.COLD,
  })
  score: LeadScoreLevel;

  @Column({ type: 'jsonb', default: {} })
  scoreBreakdown: ScoreBreakdown;

  @Column({ type: 'jsonb', default: [] })
  factors: ScoreFactor[];

  @Column({ type: 'simple-array', nullable: true })
  matchedKeywords: string[];

  @Column({ type: 'int', default: 0 })
  totalMessages: number;

  @Column({ type: 'int', default: 0 })
  incomingMessages: number;

  @Column({ type: 'int', default: 0 })
  outgoingMessages: number;

  @Column({ type: 'float', nullable: true })
  avgResponseTimeMinutes: number | null;

  @Column({ type: 'timestamp', nullable: true })
  firstInteraction: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastInteraction: Date | null;

  @Column({ type: 'boolean', default: false })
  isManualOverride: boolean;

  @Column({ type: 'varchar', nullable: true })
  manualOverrideReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  manualOverrideAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCalculatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
