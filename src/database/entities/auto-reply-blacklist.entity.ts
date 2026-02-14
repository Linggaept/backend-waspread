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

@Entity('auto_reply_blacklist')
@Index(['userId', 'phoneNumber'], { unique: true })
export class AutoReplyBlacklist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  phoneNumber: string;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
