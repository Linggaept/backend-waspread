import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ai_token_pricing')
export class AiTokenPricing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  key: string; // 'default' or feature-specific like 'auto_reply', 'copywriting'

  @Column({ type: 'int', default: 200 })
  divisor: number; // Gemini tokens / divisor = base platform tokens

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1.0 })
  markup: number; // Multiplier for profit margin (1.0 = no markup, 1.5 = 50% markup)

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.01 })
  minTokens: number; // Minimum tokens to charge per request

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
