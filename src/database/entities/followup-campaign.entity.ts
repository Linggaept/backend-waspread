import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Blast } from './blast.entity';

export enum FollowupTrigger {
  NO_REPLY = 'no_reply',
  STAGE_REPLIED = 'stage_replied',
  STAGE_INTERESTED = 'stage_interested',
  STAGE_NEGOTIATING = 'stage_negotiating',
}

export enum FollowupStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export interface FollowupStep {
  step: number;
  message: string;
  delayHours: number;
}

@Entity('followup_campaigns')
@Index(['userId', 'status'])
@Index(['userId', 'originalBlastId'])
@Index(['userId', 'createdAt'])
export class FollowupCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  name: string;

  @Column('uuid')
  originalBlastId: string;

  @ManyToOne(() => Blast, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'originalBlastId' })
  originalBlast: Blast;

  @Column({
    type: 'enum',
    enum: FollowupTrigger,
    default: FollowupTrigger.NO_REPLY,
  })
  trigger: FollowupTrigger;

  @Column({ type: 'float', default: 24 })
  delayHours: number;

  @Column({ type: 'jsonb', default: [] })
  messages: FollowupStep[];

  @Column({ default: 1 })
  maxFollowups: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({
    type: 'enum',
    enum: FollowupStatus,
    default: FollowupStatus.ACTIVE,
  })
  status: FollowupStatus;

  @Column({ default: 0 })
  totalScheduled: number;

  @Column({ default: 0 })
  totalSent: number;

  @Column({ default: 0 })
  totalSkipped: number;

  @Column({ default: 0 })
  totalFailed: number;

  @Column({ default: 0 })
  totalReplied: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
