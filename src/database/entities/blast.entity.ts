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

export enum BlastStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

@Entity('blasts')
@Index(['userId', 'status'])
@Index(['userId', 'createdAt'])
export class Blast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: BlastStatus,
    default: BlastStatus.PENDING,
  })
  status: BlastStatus;

  @Column({ default: 0 })
  totalRecipients: number;

  @Column({ default: 0 })
  sentCount: number;

  @Column({ default: 0 })
  failedCount: number;

  @Column({ default: 0 })
  invalidCount: number;

  @Column({ default: 0 })
  pendingCount: number;

  @Column({ default: 3000 })
  delayMs: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ nullable: true })
  imageUrl?: string;

  @Column({ default: 0 })
  replyCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => BlastMessage, (message) => message.blast)
  messages: BlastMessage[];
}

export enum MessageStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  INVALID_NUMBER = 'invalid_number',
}

export enum MessageErrorType {
  NONE = 'none',
  INVALID_NUMBER = 'invalid_number',
  NETWORK_ERROR = 'network_error',
  SESSION_ERROR = 'session_error',
  RATE_LIMITED = 'rate_limited',
  UNKNOWN = 'unknown',
}

@Entity('blast_messages')
@Index(['blastId', 'status'])
export class BlastMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Blast, (blast) => blast.messages)
  @JoinColumn({ name: 'blastId' })
  blast: Blast;

  @Column()
  blastId: string;

  @Column()
  phoneNumber: string;

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.PENDING,
  })
  status: MessageStatus;

  @Column({ nullable: true })
  whatsappMessageId: string;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({
    type: 'enum',
    enum: MessageErrorType,
    default: MessageErrorType.NONE,
  })
  errorType: MessageErrorType;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
