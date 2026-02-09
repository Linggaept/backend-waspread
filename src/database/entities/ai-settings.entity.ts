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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
