import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Blast, BlastMessage } from './blast.entity';

@Entity('blast_replies')
@Index(['blastId', 'createdAt'])
@Index(['blastId', 'receivedAt']) // For blast-specific replies listing
@Index(['blastMessageId'])
@Index(['phoneNumber', 'receivedAt'])
@Index(['userId', 'isRead']) // For unread replies query optimization
export class BlastReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  userId?: string; // For user-scoped queries (nullable for backward compatibility)

  @ManyToOne(() => Blast)
  @JoinColumn({ name: 'blastId' })
  blast: Blast;

  @Column()
  blastId: string;

  @ManyToOne(() => BlastMessage, { nullable: true })
  @JoinColumn({ name: 'blastMessageId' })
  blastMessage: BlastMessage;

  @Column({ nullable: true })
  blastMessageId: string;

  @Column()
  phoneNumber: string;

  @Column({ type: 'text' })
  messageContent: string;

  @Column({ nullable: true })
  whatsappMessageId: string;

  @Column({ nullable: true })
  mediaUrl: string;

  @Column({ nullable: true })
  mediaType: string; // 'image', 'video', 'audio', 'document'

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt: Date;

  @Column({ default: false })
  isRead: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
