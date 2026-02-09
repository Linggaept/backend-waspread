import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('pinned_conversations')
@Unique(['userId', 'sessionPhoneNumber', 'phoneNumber'])
@Index(['userId', 'sessionPhoneNumber'])
export class PinnedConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  sessionPhoneNumber: string;

  @Column()
  phoneNumber: string;

  @CreateDateColumn({ type: 'timestamptz' })
  pinnedAt: Date;
}
