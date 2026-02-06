import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  LeadScore,
  LeadScoreLevel,
  ScoreBreakdown,
  ScoreFactor,
} from '../../database/entities/lead-score.entity';
import { LeadScoreSettings } from '../../database/entities/lead-score-settings.entity';
import {
  ChatMessage,
  ChatMessageDirection,
} from '../../database/entities/chat-message.entity';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { UpdateLeadScoreSettingsDto } from './dto/settings.dto';
import {
  LeadQueryDto,
  ManualScoreOverrideDto,
  BulkScoreOverrideDto,
  RecalculateDto,
} from './dto/lead.dto';

// Minimum time between recalculations (in milliseconds)
const RECALCULATE_DEBOUNCE_MS = 60_000; // 1 minute

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(LeadScore)
    private readonly leadScoreRepository: Repository<LeadScore>,
    @InjectRepository(LeadScoreSettings)
    private readonly settingsRepository: Repository<LeadScoreSettings>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) {}

  // ==================== Settings ====================

  async getSettings(userId: string): Promise<LeadScoreSettings> {
    let settings = await this.settingsRepository.findOne({ where: { userId } });

    if (!settings) {
      // Create default settings
      settings = this.settingsRepository.create({ userId });
      await this.settingsRepository.save(settings);
    }

    return settings;
  }

  async updateSettings(
    userId: string,
    dto: UpdateLeadScoreSettingsDto,
  ): Promise<LeadScoreSettings> {
    let settings = await this.settingsRepository.findOne({ where: { userId } });

    if (!settings) {
      settings = this.settingsRepository.create({ userId, ...dto });
    } else {
      Object.assign(settings, dto);
    }

    return this.settingsRepository.save(settings);
  }

  // ==================== Leads List & Stats ====================

  async getLeads(userId: string, query: LeadQueryDto) {
    const { page = 1, limit = 20, score, search, sortBy, sortOrder } = query;

    const qb = this.leadScoreRepository
      .createQueryBuilder('lead')
      .where('lead.userId = :userId', { userId });

    if (score) {
      qb.andWhere('lead.score = :score', { score });
    }

    if (search) {
      qb.andWhere('lead.phoneNumber LIKE :search', { search: `%${search}%` });
    }

    // Handle sorting
    const sortField = sortBy || 'lastInteraction';
    const order = sortOrder || 'DESC';

    if (sortField === 'score') {
      // Sort by score level: hot > warm > cold
      qb.addOrderBy(
        `CASE lead.score WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END`,
        order,
      );
    } else {
      qb.addOrderBy(`lead.${sortField}`, order);
    }

    const total = await qb.getCount();

    const leads = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      data: leads.map((lead) => ({
        id: lead.id,
        phoneNumber: lead.phoneNumber,
        score: lead.score,
        scoreBreakdown: lead.scoreBreakdown,
        factors: lead.factors,
        matchedKeywords: lead.matchedKeywords,
        totalMessages: lead.totalMessages,
        incomingMessages: lead.incomingMessages,
        outgoingMessages: lead.outgoingMessages,
        avgResponseTimeMinutes: lead.avgResponseTimeMinutes,
        firstInteraction: lead.firstInteraction,
        lastInteraction: lead.lastInteraction,
        isManualOverride: lead.isManualOverride,
        manualOverrideReason: lead.manualOverrideReason,
        lastCalculatedAt: lead.lastCalculatedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async getStats(userId: string) {
    const [hotCount, warmCount, coldCount, totalCount] = await Promise.all([
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.HOT },
      }),
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.WARM },
      }),
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.COLD },
      }),
      this.leadScoreRepository.count({ where: { userId } }),
    ]);

    return {
      total: totalCount,
      hot: hotCount,
      warm: warmCount,
      cold: coldCount,
    };
  }

  async getLeadDetail(userId: string, phoneNumber: string) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const lead = await this.leadScoreRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!lead) {
      throw new NotFoundException(
        `Lead not found for phone number: ${phoneNumber}`,
      );
    }

    return lead;
  }

  // ==================== Manual Override ====================

  async overrideScore(
    userId: string,
    phoneNumber: string,
    dto: ManualScoreOverrideDto,
  ) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    let lead = await this.leadScoreRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!lead) {
      // Create a new lead record if it doesn't exist
      lead = this.leadScoreRepository.create({
        userId,
        phoneNumber: normalizedPhone,
        score: dto.score,
        scoreBreakdown: { keyword: 0, responseTime: 0, engagement: 0, recency: 0, total: 0 },
        factors: [
          {
            factor: 'manual_override',
            description: dto.reason || 'Manual override by user',
            points: 100,
          },
        ],
        isManualOverride: true,
        manualOverrideReason: dto.reason,
        manualOverrideAt: new Date(),
        lastCalculatedAt: new Date(),
      });
    } else {
      lead.score = dto.score;
      lead.isManualOverride = true;
      lead.manualOverrideReason = dto.reason || null;
      lead.manualOverrideAt = new Date();
      lead.factors = [
        {
          factor: 'manual_override',
          description: dto.reason || 'Manual override by user',
          points: 100,
        },
      ];
    }

    const saved = await this.leadScoreRepository.save(lead);

    // Emit WebSocket event
    this.emitScoreUpdate(userId, saved);

    return saved;
  }

  async removeOverride(userId: string, phoneNumber: string) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const lead = await this.leadScoreRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!lead) {
      throw new NotFoundException(
        `Lead not found for phone number: ${phoneNumber}`,
      );
    }

    // Reset manual override flags
    lead.isManualOverride = false;
    lead.manualOverrideReason = null;
    lead.manualOverrideAt = null;

    await this.leadScoreRepository.save(lead);

    // Recalculate the score
    return this.calculateScore(userId, normalizedPhone, true);
  }

  async bulkOverride(userId: string, dto: BulkScoreOverrideDto) {
    const results: Array<{ phoneNumber: string; success: boolean; error?: string }> = [];

    for (const item of dto.leads) {
      try {
        await this.overrideScore(userId, item.phoneNumber, {
          score: item.score,
          reason: item.reason,
        });
        results.push({ phoneNumber: item.phoneNumber, success: true });
      } catch (error: any) {
        results.push({
          phoneNumber: item.phoneNumber,
          success: false,
          error: error.message,
        });
      }
    }

    return { results };
  }

  // ==================== Recalculation ====================

  async recalculate(userId: string, dto?: RecalculateDto) {
    const settings = await this.getSettings(userId);

    if (!settings.isEnabled) {
      return { recalculated: 0, message: 'Lead scoring is disabled' };
    }

    let phoneNumbers: string[];

    if (dto?.phoneNumbers && dto.phoneNumbers.length > 0) {
      phoneNumbers = dto.phoneNumbers.map((p) => this.normalizePhoneNumber(p));
    } else {
      // Get all unique phone numbers from chat messages
      const result = await this.chatMessageRepository
        .createQueryBuilder('msg')
        .select('DISTINCT msg.phoneNumber', 'phoneNumber')
        .where('msg.userId = :userId', { userId })
        .getRawMany();

      phoneNumbers = result.map((r) => r.phoneNumber);
    }

    let recalculated = 0;

    for (const phoneNumber of phoneNumbers) {
      try {
        await this.calculateScore(userId, phoneNumber, true);
        recalculated++;
      } catch (error) {
        this.logger.error(
          `Failed to recalculate score for ${phoneNumber}: ${error}`,
        );
      }
    }

    return { recalculated, total: phoneNumbers.length };
  }

  // ==================== Score Calculation ====================

  /**
   * Called when a new message is received/sent
   * Debounces calculation to avoid excessive recalculations
   */
  async handleNewMessage(userId: string, phoneNumber: string): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const settings = await this.getSettings(userId);
    if (!settings.isEnabled) {
      return;
    }

    // Check if lead exists and was recently calculated (debounce)
    const existingLead = await this.leadScoreRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (existingLead) {
      // Skip if manually overridden
      if (existingLead.isManualOverride) {
        return;
      }

      // Debounce: skip if calculated within the last minute
      if (existingLead.lastCalculatedAt) {
        const timeSinceLastCalc =
          Date.now() - existingLead.lastCalculatedAt.getTime();
        if (timeSinceLastCalc < RECALCULATE_DEBOUNCE_MS) {
          return;
        }
      }
    }

    await this.calculateScore(userId, normalizedPhone, false);
  }

  /**
   * Calculate lead score based on chat history and settings
   */
  async calculateScore(
    userId: string,
    phoneNumber: string,
    force: boolean = false,
  ): Promise<LeadScore> {
    const settings = await this.getSettings(userId);
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Get existing lead or create new
    let lead = await this.leadScoreRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    // Skip if manually overridden (unless forced)
    if (lead?.isManualOverride && !force) {
      return lead;
    }

    // Get all messages for this phone number
    const messages = await this.chatMessageRepository.find({
      where: { userId, phoneNumber: normalizedPhone },
      order: { timestamp: 'ASC' },
    });

    if (messages.length === 0) {
      // No messages, return cold lead
      if (!lead) {
        lead = this.leadScoreRepository.create({
          userId,
          phoneNumber: normalizedPhone,
          score: LeadScoreLevel.COLD,
          scoreBreakdown: { keyword: 0, responseTime: 0, engagement: 0, recency: 0, total: 0 },
          factors: [],
          totalMessages: 0,
          incomingMessages: 0,
          outgoingMessages: 0,
          lastCalculatedAt: new Date(),
        });
        return this.leadScoreRepository.save(lead);
      }
      return lead;
    }

    // Calculate metrics
    const incomingMessages = messages.filter(
      (m) => m.direction === ChatMessageDirection.INCOMING,
    );
    const outgoingMessages = messages.filter(
      (m) => m.direction === ChatMessageDirection.OUTGOING,
    );

    const firstInteraction = messages[0].timestamp;
    const lastInteraction = messages[messages.length - 1].timestamp;

    // Calculate average response time (time between outgoing and incoming messages)
    const responseTimes: number[] = [];
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      // If previous is outgoing and current is incoming, this is a customer response
      if (
        prev.direction === ChatMessageDirection.OUTGOING &&
        curr.direction === ChatMessageDirection.INCOMING
      ) {
        const responseTimeMs =
          curr.timestamp.getTime() - prev.timestamp.getTime();
        responseTimes.push(responseTimeMs / 60_000); // Convert to minutes
      }
    }

    const avgResponseTimeMinutes =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;

    // Calculate scores
    const factors: ScoreFactor[] = [];
    const breakdown: ScoreBreakdown = {
      keyword: 0,
      responseTime: 0,
      engagement: 0,
      recency: 0,
      total: 0,
    };

    // 1. Keyword Score
    const matchedKeywords: string[] = [];
    const messageTexts = incomingMessages
      .map((m) => m.body?.toLowerCase() || '')
      .join(' ');

    let keywordScore = 0;
    let hasHotKeyword = false;
    let hasWarmKeyword = false;

    for (const keyword of settings.hotKeywords) {
      if (messageTexts.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
        hasHotKeyword = true;
      }
    }

    for (const keyword of settings.warmKeywords) {
      if (messageTexts.includes(keyword.toLowerCase())) {
        if (!matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
        hasWarmKeyword = true;
      }
    }

    if (hasHotKeyword) {
      keywordScore = 100;
      factors.push({
        factor: 'keyword_match',
        description: `Menyebut: ${matchedKeywords.filter((k) => settings.hotKeywords.includes(k)).join(', ')}`,
        points: 100,
      });
    } else if (hasWarmKeyword) {
      keywordScore = 50;
      factors.push({
        factor: 'keyword_match',
        description: `Menyebut: ${matchedKeywords.filter((k) => settings.warmKeywords.includes(k)).join(', ')}`,
        points: 50,
      });
    }

    breakdown.keyword = Math.round(keywordScore * (settings.keywordWeight / 100));

    // 2. Response Time Score
    if (settings.responseTimeEnabled && avgResponseTimeMinutes !== null) {
      let responseScore = 0;

      if (avgResponseTimeMinutes <= settings.hotResponseTimeMinutes) {
        responseScore = 100;
        factors.push({
          factor: 'fast_response',
          description: `Rata-rata balas ${Math.round(avgResponseTimeMinutes)} menit`,
          points: 100,
        });
      } else if (avgResponseTimeMinutes <= settings.warmResponseTimeMinutes) {
        responseScore = 50;
        factors.push({
          factor: 'moderate_response',
          description: `Rata-rata balas ${Math.round(avgResponseTimeMinutes)} menit`,
          points: 50,
        });
      } else {
        factors.push({
          factor: 'slow_response',
          description: `Rata-rata balas ${Math.round(avgResponseTimeMinutes)} menit`,
          points: 0,
        });
      }

      breakdown.responseTime = Math.round(
        responseScore * (settings.responseTimeWeight / 100),
      );
    }

    // 3. Engagement Score
    if (settings.engagementEnabled) {
      let engagementScore = 0;
      const totalMsgCount = messages.length;

      if (totalMsgCount >= settings.hotMessageCount) {
        engagementScore = 100;
        factors.push({
          factor: 'high_engagement',
          description: `${totalMsgCount} pesan, aktif berdiskusi`,
          points: 100,
        });
      } else if (totalMsgCount >= settings.warmMessageCount) {
        engagementScore = 50;
        factors.push({
          factor: 'moderate_engagement',
          description: `${totalMsgCount} pesan`,
          points: 50,
        });
      } else {
        factors.push({
          factor: 'low_engagement',
          description: `${totalMsgCount} pesan`,
          points: 0,
        });
      }

      breakdown.engagement = Math.round(
        engagementScore * (settings.engagementWeight / 100),
      );
    }

    // 4. Recency Score
    if (settings.recencyEnabled) {
      let recencyScore = 0;
      const hoursSinceLastActivity =
        (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastActivity <= settings.hotRecencyHours) {
        recencyScore = 100;
        factors.push({
          factor: 'recent_activity',
          description: `Aktif ${Math.round(hoursSinceLastActivity)} jam lalu`,
          points: 100,
        });
      } else if (hoursSinceLastActivity <= settings.warmRecencyHours) {
        recencyScore = 50;
        factors.push({
          factor: 'moderate_activity',
          description: `Aktif ${Math.round(hoursSinceLastActivity)} jam lalu`,
          points: 50,
        });
      } else {
        factors.push({
          factor: 'inactive',
          description: `Tidak aktif ${Math.round(hoursSinceLastActivity)} jam`,
          points: 0,
        });
      }

      breakdown.recency = Math.round(
        recencyScore * (settings.recencyWeight / 100),
      );
    }

    // Calculate total score
    breakdown.total =
      breakdown.keyword +
      breakdown.responseTime +
      breakdown.engagement +
      breakdown.recency;

    // Determine score level
    let scoreLevel: LeadScoreLevel;
    if (breakdown.total >= settings.hotThreshold) {
      scoreLevel = LeadScoreLevel.HOT;
    } else if (breakdown.total >= settings.warmThreshold) {
      scoreLevel = LeadScoreLevel.WARM;
    } else {
      scoreLevel = LeadScoreLevel.COLD;
    }

    // Create or update lead
    if (!lead) {
      lead = this.leadScoreRepository.create({
        userId,
        phoneNumber: normalizedPhone,
      });
    }

    const previousScore = lead.score;

    lead.score = scoreLevel;
    lead.scoreBreakdown = breakdown;
    lead.factors = factors;
    lead.matchedKeywords = matchedKeywords;
    lead.totalMessages = messages.length;
    lead.incomingMessages = incomingMessages.length;
    lead.outgoingMessages = outgoingMessages.length;
    lead.avgResponseTimeMinutes = avgResponseTimeMinutes;
    lead.firstInteraction = firstInteraction;
    lead.lastInteraction = lastInteraction;
    lead.lastCalculatedAt = new Date();

    // Reset manual override if force recalculating
    if (force && lead.isManualOverride) {
      lead.isManualOverride = false;
      lead.manualOverrideReason = null;
      lead.manualOverrideAt = null;
    }

    const saved = await this.leadScoreRepository.save(lead);

    // Emit WebSocket event if score changed
    if (previousScore !== scoreLevel) {
      this.emitScoreUpdate(userId, saved);
    }

    return saved;
  }

  // ==================== Helpers ====================

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    if (cleaned.startsWith('62') && cleaned.length > 13 && cleaned.endsWith('0')) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }

  private emitScoreUpdate(userId: string, lead: LeadScore): void {
    this.whatsAppGateway.server.to(`user:${userId}`).emit('lead:score-update', {
      phoneNumber: lead.phoneNumber,
      score: lead.score,
      factors: lead.factors,
      lastCalculatedAt: lead.lastCalculatedAt,
    });

    this.logger.log(
      `Lead score updated for ${lead.phoneNumber}: ${lead.score}`,
    );
  }
}
