import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export interface FunnelCounts {
  blast_sent: number;
  delivered: number;
  replied: number;
  interested: number;
  negotiating: number;
  closed_won: number;
  closed_lost: number;
}

export interface LeadCounts {
  hot: number;
  warm: number;
  cold: number;
}

@Entity('analytics_snapshots')
@Index(['userId', 'date'], { unique: true })
export class AnalyticsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'date' })
  date: Date;

  // Message Stats
  @Column({ type: 'int', default: 0 })
  totalMessagesSent: number;

  @Column({ type: 'int', default: 0 })
  totalMessagesReceived: number;

  @Column({ type: 'int', default: 0 })
  totalBlastsSent: number;

  // Conversation Stats
  @Column({ type: 'int', default: 0 })
  newConversations: number;

  @Column({ type: 'int', default: 0 })
  activeConversations: number;

  @Column({ type: 'int', default: 0 })
  unrepliedConversations: number;

  // Funnel Stats
  @Column({ type: 'jsonb', default: {} })
  funnelCounts: FunnelCounts;

  // Lead Stats
  @Column({ type: 'jsonb', default: {} })
  leadCounts: LeadCounts;

  // Response Metrics
  @Column({ type: 'float', nullable: true })
  avgResponseTimeMinutes: number | null;

  @Column({ type: 'float', nullable: true })
  responseRate: number | null;

  // Revenue
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalRevenue: number;

  @Column({ type: 'int', default: 0 })
  closedDeals: number;

  @CreateDateColumn()
  createdAt: Date;
}
