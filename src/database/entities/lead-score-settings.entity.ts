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

@Entity('lead_score_settings')
export class LeadScoreSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  // Keyword settings
  @Column({
    type: 'simple-array',
    default: 'beli,order,transfer,bayar,checkout,pesan,mau',
  })
  hotKeywords: string[];

  @Column({
    type: 'simple-array',
    default: 'harga,promo,diskon,info,tanya,berapa,ready',
  })
  warmKeywords: string[];

  @Column({
    type: 'simple-array',
    default:
      'deal,ok fix,fix order,sudah transfer,sudah bayar,sudah tf,done transfer,udah bayar,udah transfer',
  })
  closedWonKeywords: string[];

  @Column({
    type: 'simple-array',
    default: 'cancel,batal,gak jadi,mahal,skip,tidak jadi',
  })
  closedLostKeywords: string[];

  @Column({ type: 'int', default: 40 })
  keywordWeight: number;

  // Response time settings
  @Column({ type: 'boolean', default: true })
  responseTimeEnabled: boolean;

  @Column({ type: 'int', default: 5 })
  hotResponseTimeMinutes: number;

  @Column({ type: 'int', default: 30 })
  warmResponseTimeMinutes: number;

  @Column({ type: 'int', default: 25 })
  responseTimeWeight: number;

  // Engagement settings
  @Column({ type: 'boolean', default: true })
  engagementEnabled: boolean;

  @Column({ type: 'int', default: 10 })
  hotMessageCount: number;

  @Column({ type: 'int', default: 5 })
  warmMessageCount: number;

  @Column({ type: 'int', default: 20 })
  engagementWeight: number;

  // Recency settings
  @Column({ type: 'boolean', default: true })
  recencyEnabled: boolean;

  @Column({ type: 'int', default: 24 })
  hotRecencyHours: number;

  @Column({ type: 'int', default: 72 })
  warmRecencyHours: number;

  @Column({ type: 'int', default: 15 })
  recencyWeight: number;

  // Score thresholds
  @Column({ type: 'int', default: 70 })
  hotThreshold: number;

  @Column({ type: 'int', default: 40 })
  warmThreshold: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
