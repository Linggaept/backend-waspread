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
import { User } from './user.entity';

export enum ContactFollowupStatus {
  SCHEDULED = 'scheduled',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('contact_followups')
@Index(['userId', 'status'])
@Index(['userId', 'phoneNumber'])
@Index(['status', 'scheduledAt'])
export class ContactFollowup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  phoneNumber: string;

  @Column({ nullable: true })
  contactName: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ nullable: true })
  note: string; // Internal note for user reference

  @Column({
    type: 'enum',
    enum: ContactFollowupStatus,
    default: ContactFollowupStatus.SCHEDULED,
  })
  status: ContactFollowupStatus;

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
