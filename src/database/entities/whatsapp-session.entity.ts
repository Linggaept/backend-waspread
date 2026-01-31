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

export enum SessionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  SCANNING = 'scanning',
  CONNECTED = 'connected',
  FAILED = 'failed',
}

@Entity('whatsapp_sessions')
export class WhatsAppSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ unique: true })
  userId: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ nullable: true })
  pushName: string;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.DISCONNECTED,
  })
  status: SessionStatus;

  @Column({ nullable: true })
  lastQrCode: string;

  @Column({ nullable: true })
  lastConnectedAt: Date;

  @Column({ nullable: true })
  lastDisconnectedAt: Date;

  @Column({ nullable: true })
  disconnectReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
