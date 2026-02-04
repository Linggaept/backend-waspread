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

export enum NotificationType {
  // Account
  WELCOME = 'welcome',
  PASSWORD_CHANGED = 'password_changed',

  // Subscription
  SUBSCRIPTION_ACTIVATED = 'subscription_activated',
  SUBSCRIPTION_EXPIRING = 'subscription_expiring',
  SUBSCRIPTION_EXPIRED = 'subscription_expired',
  QUOTA_LOW = 'quota_low',
  QUOTA_DEPLETED = 'quota_depleted',

  // Payment
  PAYMENT_SUCCESS = 'payment_success',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_PENDING = 'payment_pending',

  // WhatsApp
  SESSION_CONNECTED = 'session_connected',
  SESSION_DISCONNECTED = 'session_disconnected',
  SESSION_EXPIRED = 'session_expired',

  // Blast
  BLAST_STARTED = 'blast_started',
  BLAST_COMPLETED = 'blast_completed',
  BLAST_FAILED = 'blast_failed',
  BLAST_REPLY = 'blast_reply',
}

export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  WEBSOCKET = 'websocket',
}

@Entity('notifications')
@Index(['userId', 'isRead'])
@Index(['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  readAt: Date;

  @Column({
    type: 'simple-array',
    default: 'in_app',
  })
  channels: NotificationChannel[];

  @Column({ default: false })
  emailSent: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
