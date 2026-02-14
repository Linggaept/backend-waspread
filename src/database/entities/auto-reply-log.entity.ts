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
import { AutoReplyStatus } from './ai-settings.entity';

@Entity('auto_reply_logs')
@Index(['userId', 'phoneNumber', 'sentAt'])
@Index(['userId', 'status'])
export class AutoReplyLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  phoneNumber: string;

  @Column({ type: 'varchar', nullable: true })
  incomingMessageId: string | null;

  @Column({ type: 'text', nullable: true })
  incomingMessageBody: string | null;

  @Column({ type: 'boolean', default: false })
  hasMedia: boolean;

  @Column({ type: 'varchar', nullable: true })
  mediaMimetype: string | null;

  @Column({ type: 'text', nullable: true })
  replyMessage: string | null;

  @Column({ type: 'varchar', nullable: true })
  whatsappMessageId: string | null;

  @Column({
    type: 'enum',
    enum: AutoReplyStatus,
    default: AutoReplyStatus.QUEUED,
  })
  status: AutoReplyStatus;

  @Column({ type: 'varchar', nullable: true })
  skipReason: string | null; // e.g., 'cooldown', 'blacklisted', 'outside_hours', 'quota_exceeded'

  @Column({ type: 'int', nullable: true })
  delaySeconds: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  queuedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
