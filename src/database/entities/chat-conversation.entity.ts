import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Blast } from './blast.entity';

@Entity('chat_conversations')
@Unique(['userId', 'sessionPhoneNumber', 'phoneNumber']) // One record per conversation
@Index(['userId', 'sessionPhoneNumber', 'lastMessageTimestamp']) // For sorting list
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  sessionPhoneNumber: string;

  @Column()
  phoneNumber: string;

  @Column({ nullable: true })
  contactName?: string; // Cache contact name

  @Column({ nullable: true })
  pushName?: string; // Cache pushname

  @Column({ nullable: true })
  lastMessageId?: string;

  @Column({ type: 'text', nullable: true })
  lastMessageBody?: string;

  @Column({ nullable: true })
  lastMessageType?: string;

  @Column({ nullable: true })
  lastMessageDirection?: string;

  @Column({ default: false })
  hasMedia: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageTimestamp?: Date;

  @Column({ default: 0 })
  unreadCount: number;

  @Column({ default: false })
  isPinned: boolean;

  @Column({ nullable: true })
  blastId?: string; // Last blast ID

  @ManyToOne(() => Blast, { nullable: true })
  @JoinColumn({ name: 'blastId' })
  blast?: Blast;

  @Column({ nullable: true })
  blastName?: string; // Cache blast name

  @UpdateDateColumn()
  updatedAt: Date;
}
