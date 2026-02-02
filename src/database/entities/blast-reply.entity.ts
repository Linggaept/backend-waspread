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
@Index(['blastMessageId'])
@Index(['phoneNumber', 'receivedAt'])
export class BlastReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column()
  receivedAt: Date;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  readAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
