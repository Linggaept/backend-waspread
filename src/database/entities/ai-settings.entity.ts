import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum ReplyTone {
  FORMAL = 'formal',
  CASUAL = 'casual',
  FRIENDLY = 'friendly',
}

export enum AutoReplyStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Entity('ai_settings')
export class AiSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ unique: true })
  userId: string;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ nullable: true })
  businessName: string;

  @Column({ type: 'text', nullable: true })
  businessDescription: string;

  @Column({
    type: 'enum',
    enum: ReplyTone,
    default: ReplyTone.FRIENDLY,
  })
  replyTone: ReplyTone;

  // ==================== Auto-Reply Settings ====================

  @Column({ default: false })
  autoReplyEnabled: boolean;

  @Column({ type: 'time', nullable: true })
  workingHoursStart: string; // e.g., '08:00'

  @Column({ type: 'time', nullable: true })
  workingHoursEnd: string; // e.g., '21:00'

  @Column({ default: true })
  workingHoursEnabled: boolean;

  @Column({ default: 5 })
  autoReplyDelayMin: number; // seconds

  @Column({ default: 10 })
  autoReplyDelayMax: number; // seconds

  @Column({ default: 60 })
  autoReplyCooldownMinutes: number;

  @Column({ type: 'text', nullable: true })
  autoReplyFallbackMessage: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
