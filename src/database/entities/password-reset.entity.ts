import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('password_resets')
@Index(['email', 'createdAt'])
export class PasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  email: string;

  @Column()
  code: string; // 6-digit OTP

  @Column({ nullable: true })
  resetToken: string; // UUID for reset step

  @Column({ default: false })
  isVerified: boolean;

  @Column({ default: false })
  isUsed: boolean;

  @Column()
  expiresAt: Date; // 15 minutes from creation

  @CreateDateColumn()
  createdAt: Date;
}
