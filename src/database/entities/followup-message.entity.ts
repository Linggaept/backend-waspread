import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FollowupCampaign } from './followup-campaign.entity';
import { BlastMessage } from './blast.entity';

export enum FollowupMessageStatus {
  SCHEDULED = 'scheduled',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

@Entity('followup_messages')
@Index(['followupCampaignId', 'status'])
@Index(['followupCampaignId', 'scheduledAt'])
@Index(['phoneNumber', 'followupCampaignId'])
@Index(['originalBlastMessageId'])
export class FollowupMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  followupCampaignId: string;

  @ManyToOne(() => FollowupCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'followupCampaignId' })
  followupCampaign: FollowupCampaign;

  @Column('uuid')
  originalBlastMessageId: string;

  @ManyToOne(() => BlastMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'originalBlastMessageId' })
  originalBlastMessage: BlastMessage;

  @Column()
  phoneNumber: string;

  @Column({ default: 1 })
  step: number;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: FollowupMessageStatus,
    default: FollowupMessageStatus.SCHEDULED,
  })
  status: FollowupMessageStatus;

  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  queuedAt: Date;

  @Column({ nullable: true })
  whatsappMessageId: string;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ default: 0 })
  retryCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
