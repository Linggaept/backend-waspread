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

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system',
}

@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ unique: true })
  userId: string;

  @Column({
    type: 'enum',
    enum: ThemeMode,
    default: ThemeMode.SYSTEM,
  })
  theme: ThemeMode;

  @Column({ default: true })
  notificationSound: boolean;

  @Column({ default: true })
  notificationDesktop: boolean;

  @Column({ nullable: true })
  language: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
