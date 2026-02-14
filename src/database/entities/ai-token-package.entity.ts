import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ai_token_packages')
export class AiTokenPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string; // e.g., "100 Token", "500 Token"

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tokenAmount: number; // Base tokens

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  bonusTokens: number; // Bonus tokens for larger packages

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isPopular: boolean; // Highlight as popular choice

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  // Virtual getter for total tokens
  get totalTokens(): number {
    return Number(this.tokenAmount) + Number(this.bonusTokens);
  }
}
