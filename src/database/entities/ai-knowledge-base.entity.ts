import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum KnowledgeCategory {
  PRODUCT = 'product',
  FAQ = 'faq',
  PROMO = 'promo',
  POLICY = 'policy',
  CUSTOM = 'custom',
}

@Entity('ai_knowledge_base')
@Index(['userId', 'isActive'])
@Index(['userId', 'category'])
export class AiKnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: KnowledgeCategory,
    default: KnowledgeCategory.CUSTOM,
  })
  category: KnowledgeCategory;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', array: true, nullable: true })
  keywords: string[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
