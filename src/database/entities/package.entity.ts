import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ default: 30 })
  durationDays: number;

  // Blast Quota (recipients that can receive blast messages)
  @Column({ default: 1000 })
  blastMonthlyQuota: number;

  @Column({ default: 100 })
  blastDailyLimit: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: true })
  isPurchasable: boolean;

  @Column({ default: false })
  isPopular: boolean;

  @Column({ default: false })
  isDiscount: boolean;

  // Original price before discount (null if no discount)
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  originalPrice: number;

  @Column({ default: 0 })
  sortOrder: number;

  // AI Quota (0 = unlimited)
  @Column({ default: 0 })
  aiQuota: number;

  // Feature Flags
  @Column({ default: true })
  hasAnalytics: boolean;

  @Column({ default: true })
  hasAiFeatures: boolean;

  @Column({ default: true })
  hasLeadScoring: boolean;

  @Column({ default: true })
  hasFollowupFeature: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
