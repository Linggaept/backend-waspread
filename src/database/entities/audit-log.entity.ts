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

export enum AuditAction {
  // Auth
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  REGISTER = 'REGISTER',
  PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_COMPLETE = 'PASSWORD_RESET_COMPLETE',

  // Blast
  BLAST_CREATED = 'BLAST_CREATED',
  BLAST_STARTED = 'BLAST_STARTED',
  BLAST_COMPLETED = 'BLAST_COMPLETED',
  BLAST_CANCELLED = 'BLAST_CANCELLED',

  // Payment
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED = 'PAYMENT_FAILED',

  // WhatsApp
  WHATSAPP_CONNECTED = 'WHATSAPP_CONNECTED',
  WHATSAPP_DISCONNECTED = 'WHATSAPP_DISCONNECTED',

  // Profile
  PROFILE_UPDATED = 'PROFILE_UPDATED',

  // Contact
  CONTACTS_IMPORTED = 'CONTACTS_IMPORTED',

  // Admin
  ADMIN_USER_CREATED = 'ADMIN_USER_CREATED',
  ADMIN_USER_UPDATED = 'ADMIN_USER_UPDATED',
  ADMIN_USER_DELETED = 'ADMIN_USER_DELETED',
}

@Entity('audit_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ nullable: true })
  ip: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
