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
  PENDING = 'pending',
  SENT = 'sent',
  RECEIVED = 'received',
  FAILED = 'failed',
}

@Entity('chat_messages')
@Index(['userId', 'phoneNumber', 'timestamp'])
@Index(['userId', 'phoneNumber'])
@Index(['userId', 'timestamp'])
@Index(['whatsappMessageId'], { unique: true, where: '"whatsappMessageId" IS NOT NULL' })
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
