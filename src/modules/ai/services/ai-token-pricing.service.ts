import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTokenPricing } from '../../../database/entities/ai-token-pricing.entity';

export interface TokenPricingConfig {
  divisor: number;
  markup: number;
  minTokens: number;
}

@Injectable()
export class AiTokenPricingService implements OnModuleInit {
  private readonly logger = new Logger(AiTokenPricingService.name);

  // Cache for pricing config
  private pricingCache: Map<string, TokenPricingConfig> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(
    @InjectRepository(AiTokenPricing)
    private readonly pricingRepository: Repository<AiTokenPricing>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaultPricing();
      await this.refreshCache();
    } catch (error) {
      // Table might not exist yet (migration not run)
      this.logger.warn(
        `[AI-PRICING] Could not initialize pricing table: ${error}. ` +
        `Run migrations to create the table. Using hardcoded defaults.`,
      );
    }
  }

  /**
   * Seed default pricing if not exists
   * Default: divisor=3450, markup=1.0 = ~5x profit margin
   */
  private async seedDefaultPricing(): Promise<void> {
    const existing = await this.pricingRepository.findOne({
      where: { key: 'default' },
    });

    if (!existing) {
      const defaultPricing = this.pricingRepository.create({
        key: 'default',
        divisor: 3450, // 1000 Gemini tokens = 0.29 platform tokens
        markup: 1.0,
        minTokens: 0.01, // Minimum 0.01 token charge
        description: 'Default pricing (~5x profit margin)',
      });
      await this.pricingRepository.save(defaultPricing);
      this.logger.log('[AI-PRICING] Default pricing seeded: divisor=3450, markup=1.0 (~5x profit)');
    }
  }

  /**
   * Refresh cache from database
   */
  private async refreshCache(): Promise<void> {
    const pricings = await this.pricingRepository.find({
      where: { isActive: true },
    });

    this.pricingCache.clear();
    for (const p of pricings) {
      this.pricingCache.set(p.key, {
        divisor: p.divisor,
        markup: Number(p.markup),
        minTokens: p.minTokens,
      });
    }
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

    this.logger.debug(`[AI-PRICING] Cache refreshed with ${pricings.length} entries`);
  }

  /**
   * Get pricing config for a feature (or default)
   */
  async getPricingConfig(featureKey?: string): Promise<TokenPricingConfig> {
    // Refresh cache if expired
    if (Date.now() > this.cacheExpiry) {
      await this.refreshCache();
    }

    // Try feature-specific first, then fallback to default
    if (featureKey && this.pricingCache.has(featureKey)) {
      return this.pricingCache.get(featureKey)!;
    }

    // Return default or hardcoded fallback
    return (
      this.pricingCache.get('default') || {
        divisor: 3450,
        markup: 1.0,
        minTokens: 0.01,
      }
    );
  }

  /**
   * Calculate platform tokens from Gemini tokens
   * Returns float with 2 decimal places for fair pricing
   */
  async calculatePlatformTokens(
    geminiTokens: number,
    featureKey?: string,
  ): Promise<number> {
    const config = await this.getPricingConfig(featureKey);
    const baseTokens = geminiTokens / config.divisor;
    const withMarkup = baseTokens * config.markup;
    // Round to 2 decimal places, apply minimum
    const result = Math.round(withMarkup * 100) / 100;
    return Math.max(result, config.minTokens);
  }

  // ==================== CRUD Operations ====================

  async findAll(): Promise<AiTokenPricing[]> {
    return this.pricingRepository.find({
      order: { key: 'ASC' },
    });
  }

  async findOne(id: string): Promise<AiTokenPricing> {
    const pricing = await this.pricingRepository.findOne({ where: { id } });
    if (!pricing) {
      throw new NotFoundException('Pricing config not found');
    }
    return pricing;
  }

  async findByKey(key: string): Promise<AiTokenPricing | null> {
    return this.pricingRepository.findOne({ where: { key } });
  }

  async create(data: {
    key: string;
    divisor?: number;
    markup?: number;
    minTokens?: number;
    description?: string;
  }): Promise<AiTokenPricing> {
    const pricing = this.pricingRepository.create({
      key: data.key,
      divisor: data.divisor ?? 3450,
      markup: data.markup ?? 1.0,
      minTokens: data.minTokens ?? 0.01,
      description: data.description,
    });

    const saved = await this.pricingRepository.save(pricing);
    await this.refreshCache();

    this.logger.log(`[AI-PRICING] Created pricing for '${data.key}'`);
    return saved;
  }

  async update(
    id: string,
    data: {
      divisor?: number;
      markup?: number;
      minTokens?: number;
      isActive?: boolean;
      description?: string;
    },
  ): Promise<AiTokenPricing> {
    const pricing = await this.findOne(id);
    Object.assign(pricing, data);

    const saved = await this.pricingRepository.save(pricing);
    await this.refreshCache();

    this.logger.log(`[AI-PRICING] Updated pricing '${pricing.key}'`);
    return saved;
  }

  async delete(id: string): Promise<void> {
    const pricing = await this.findOne(id);

    // Prevent deleting default
    if (pricing.key === 'default') {
      throw new Error('Cannot delete default pricing');
    }

    await this.pricingRepository.remove(pricing);
    await this.refreshCache();

    this.logger.log(`[AI-PRICING] Deleted pricing '${pricing.key}'`);
  }

  /**
   * Get current pricing summary for display
   */
  async getPricingSummary(): Promise<{
    default: TokenPricingConfig;
    features: Record<string, TokenPricingConfig>;
    examples: Array<{ geminiTokens: number; platformTokens: number; description: string }>;
  }> {
    await this.refreshCache();

    const defaultConfig = await this.getPricingConfig();
    const features: Record<string, TokenPricingConfig> = {};

    for (const [key, config] of this.pricingCache) {
      if (key !== 'default') {
        features[key] = config;
      }
    }

    // Calculate examples with decimal precision
    const examples = [
      { geminiTokens: 500, description: 'Simple text reply' },
      { geminiTokens: 1000, description: 'Auto-reply with context' },
      { geminiTokens: 2500, description: 'Image analysis' },
      { geminiTokens: 5000, description: 'PDF/heavy processing' },
    ].map((ex) => {
      const baseTokens = ex.geminiTokens / defaultConfig.divisor;
      const withMarkup = baseTokens * defaultConfig.markup;
      const platformTokens = Math.round(Math.max(withMarkup, defaultConfig.minTokens) * 100) / 100;
      return { ...ex, platformTokens };
    });

    return {
      default: defaultConfig,
      features,
      examples,
    };
  }
}
