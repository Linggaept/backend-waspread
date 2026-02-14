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
import { AiTokenPackage } from './ai-token-package.entity';

export enum AiTokenPurchaseStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

@Entity('ai_token_purchases')
@Index(['userId', 'createdAt'])
@Index(['orderId'], { unique: true, where: '"orderId" IS NOT NULL' })
export class AiTokenPurchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => AiTokenPackage)
  @JoinColumn({ name: 'packageId' })
  package: AiTokenPackage;

  @Column()
  packageId: string;

  @Column()
  tokenAmount: number; // Total tokens received (base + bonus)

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  // Midtrans integration
  @Column({ nullable: true, unique: true })
  orderId: string; // Midtrans order ID (e.g., "TKN-1234567890-abc123")

  @Column({ nullable: true })
  snapToken: string; // Midtrans snap token

  @Column({ nullable: true })
  transactionId: string; // Midtrans transaction ID

  @Column({ nullable: true })
  paymentType: string; // e.g., "bank_transfer", "gopay", etc.

  @Column({
    type: 'enum',
    enum: AiTokenPurchaseStatus,
    default: AiTokenPurchaseStatus.PENDING,
  })
  status: AiTokenPurchaseStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date;
}
