import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('contacts')
@Unique(['userId', 'phoneNumber'])
@Index(['userId'])
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  phoneNumber: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  notes?: string;

  @Column({ type: 'jsonb', nullable: true })
  tags?: string[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 'manual' })
  source: string; // 'manual' | 'whatsapp' | 'import'

  @Column({ nullable: true })
  waName?: string; // Nama dari profil WhatsApp (pushname)

  @Column({ default: false })
  isWaContact: boolean; // Terdaftar di WhatsApp

  @Column({ nullable: true })
  lastSyncedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
