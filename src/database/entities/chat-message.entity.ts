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
import { Blast } from './blast.entity';

export enum ChatMessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export enum ChatMessageStatus {
  PENDING = 'pending', // ⏳ Sending...
  SENT = 'sent', // ✓ (1 check) - Sent to server
  DELIVERED = 'delivered', // ✓✓ (2 checks gray) - Delivered to device
  READ = 'read', // ✓✓ (2 checks blue) - Read by recipient
  RECEIVED = 'received', // For incoming messages
  FAILED = 'failed', // ✗ Failed to send
}

@Entity('chat_messages')
@Index(['userId', 'sessionPhoneNumber', 'phoneNumber', 'timestamp'])
@Index(['userId', 'sessionPhoneNumber', 'phoneNumber'])
@Index(['userId', 'sessionPhoneNumber', 'timestamp'])
@Index(['userId', 'phoneNumber', 'timestamp'])
@Index(['userId', 'phoneNumber'])
@Index(['userId', 'timestamp'])
@Index(['userId', 'sessionPhoneNumber', 'phoneNumber', 'direction', 'isRead']) // Optimize unread counts
@Index(['whatsappMessageId'], {
  unique: true,
  where: '"whatsappMessageId" IS NOT NULL',
})
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({ nullable: true })
  sessionPhoneNumber: string;

  @Column()
  phoneNumber: string;

  @Column({
    type: 'enum',
    enum: ChatMessageDirection,
  })
  direction: ChatMessageDirection;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ default: false })
  hasMedia: boolean;

  @Column({ nullable: true })
  mediaType?: string;

  @Column({ nullable: true })
  mediaUrl?: string;

  @Column({ nullable: true })
  mimetype?: string;

  @Column({ nullable: true })
  fileName?: string;

  @Column({ nullable: true })
  whatsappMessageId?: string;

  @Column({ default: 'unknown' })
  messageType: string;

  @Column({
    type: 'enum',
    enum: ChatMessageStatus,
    default: ChatMessageStatus.SENT,
  })
  status: ChatMessageStatus;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @ManyToOne(() => Blast, { nullable: true })
  @JoinColumn({ name: 'blastId' })
  blast?: Blast;

  @Column({ nullable: true })
  blastId?: string;

  @Column({ default: false })
  isRead: boolean;

  @Column({ default: false })
  isRetracted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
