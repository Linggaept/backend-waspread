import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ConversationFunnel,
  FunnelStage,
} from '../../../database/entities/conversation-funnel.entity';
import {
  AnalyticsSnapshot,
  FunnelCounts,
  LeadCounts,
} from '../../../database/entities/analytics-snapshot.entity';
import {
  ChatMessage,
  ChatMessageDirection,
} from '../../../database/entities/chat-message.entity';
import {
  LeadScore,
  LeadScoreLevel,
} from '../../../database/entities/lead-score.entity';
import { Blast } from '../../../database/entities/blast.entity';
import { Contact } from '../../../database/entities/contact.entity';
import {
  AnalyticsPeriod,
  AnalyticsQueryDto,
  FunnelQueryDto,
  UnrepliedQueryDto,
  ConversationListQueryDto,
} from '../dto';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  // In-memory cache for analytics overview (TTL: 5 minutes)
  private overviewCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(ConversationFunnel)
    private readonly funnelRepository: Repository<ConversationFunnel>,
    @InjectRepository(AnalyticsSnapshot)
    private readonly snapshotRepository: Repository<AnalyticsSnapshot>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(LeadScore)
    private readonly leadScoreRepository: Repository<LeadScore>,
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  // ==================== Overview Dashboard ====================

  async getOverview(userId: string, query: AnalyticsQueryDto) {
    // Check cache first
    const cacheKey = `${userId}:${query.period || '7d'}:${query.startDate || ''}:${query.endDate || ''}`;
    const cached = this.overviewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache hit for analytics overview: ${cacheKey}`);
      return cached.data;
    }

    const dateRange = this.getDateRange(query);

    // Get message counts
    const [messagesSent, messagesReceived] = await Promise.all([
      this.chatMessageRepository.count({
        where: {
          userId,
          direction: ChatMessageDirection.OUTGOING,
          timestamp: Between(dateRange.startDate, dateRange.endDate),
        },
      }),
      this.chatMessageRepository.count({
        where: {
          userId,
          direction: ChatMessageDirection.INCOMING,
          timestamp: Between(dateRange.startDate, dateRange.endDate),
        },
      }),
    ]);

    // Get conversation metrics
    const activeConversations = await this.getActiveConversationsCount(
      userId,
      dateRange,
    );
    const unrepliedChats = await this.getUnrepliedCount(userId);

    // Get lead counts
    const leadCounts = await this.getLeadCounts(userId);

    // Get funnel summary
    const funnelSummary = await this.getFunnelCounts(userId, dateRange);

    // Get revenue
    const revenue = await this.getRevenue(userId, dateRange);

    // Calculate response rate
    const responseRate =
      messagesSent > 0
        ? Math.round((messagesReceived / messagesSent) * 100 * 10) / 10
        : 0;

    // Calculate avg response time
    const avgResponseTime = await this.getAvgResponseTime(userId, dateRange);

    const result = {
      period: query.period || AnalyticsPeriod.LAST_7_DAYS,
      dateRange: {
        start: dateRange.startDate,
        end: dateRange.endDate,
      },
      summary: {
        totalConversations: activeConversations,
        activeConversations,
        unrepliedChats,
        avgResponseTime: avgResponseTime
          ? `${Math.round(avgResponseTime)} min`
          : 'N/A',
        responseRate,
      },
      messages: {
        sent: messagesSent,
        received: messagesReceived,
        total: messagesSent + messagesReceived,
      },
      leads: {
        ...leadCounts,
        conversionRate: this.calculateConversionRate(funnelSummary),
      },
      funnel: funnelSummary,
      revenue: {
        totalDeals: revenue.totalDeals,
        totalValue: revenue.totalValue,
        avgDealValue:
          revenue.totalDeals > 0
            ? Math.round(revenue.totalValue / revenue.totalDeals)
            : 0,
      },
    };

    // Cache the result
    this.overviewCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    // Cleanup old cache entries (prevent memory leak)
    if (this.overviewCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.overviewCache.entries()) {
        if (value.expiresAt < now) {
          this.overviewCache.delete(key);
        }
      }
    }

    return result;
  }

  // ==================== Funnel Analytics ====================

  async getFunnelAnalytics(userId: string, query: FunnelQueryDto) {
    const dateRange = this.getDateRange(query);

    const qb = this.funnelRepository
      .createQueryBuilder('funnel')
      .where('funnel.userId = :userId', { userId })
      .andWhere('funnel.createdAt >= :startDate', {
        startDate: dateRange.startDate,
      })
      .andWhere('funnel.createdAt <= :endDate', { endDate: dateRange.endDate });

    if (query.blastId) {
      qb.andWhere('funnel.blastId = :blastId', { blastId: query.blastId });
    }

    const funnels = await qb.getMany();

    // Count by stage
    const stageCounts: Record<FunnelStage, number> = {
      [FunnelStage.BLAST_SENT]: 0,
      [FunnelStage.DELIVERED]: 0,
      [FunnelStage.REPLIED]: 0,
      [FunnelStage.INTERESTED]: 0,
      [FunnelStage.NEGOTIATING]: 0,
      [FunnelStage.CLOSED_WON]: 0,
      [FunnelStage.CLOSED_LOST]: 0,
    };

    // Count funnels that reached each stage
    for (const funnel of funnels) {
      // Count current stage and all previous stages
      const stageOrder = [
        FunnelStage.BLAST_SENT,
        FunnelStage.DELIVERED,
        FunnelStage.REPLIED,
        FunnelStage.INTERESTED,
        FunnelStage.NEGOTIATING,
      ];

      const currentIndex = stageOrder.indexOf(funnel.currentStage);

      if (currentIndex >= 0) {
        // Count all stages up to current
        for (let i = 0; i <= currentIndex; i++) {
          stageCounts[stageOrder[i]]++;
        }
      }

      // Handle closed stages
      if (funnel.currentStage === FunnelStage.CLOSED_WON) {
        stageCounts[FunnelStage.CLOSED_WON]++;
        // Also count all previous stages
        for (const stage of stageOrder) {
          stageCounts[stage]++;
        }
      } else if (funnel.currentStage === FunnelStage.CLOSED_LOST) {
        stageCounts[FunnelStage.CLOSED_LOST]++;
      }
    }

    const total = funnels.length || 1; // Avoid division by zero

    // Build funnel response
    const funnelStages = [
      { stage: FunnelStage.BLAST_SENT, label: 'Blast Sent' },
      { stage: FunnelStage.DELIVERED, label: 'Delivered' },
      { stage: FunnelStage.REPLIED, label: 'Replied' },
      { stage: FunnelStage.INTERESTED, label: 'Interested' },
      { stage: FunnelStage.NEGOTIATING, label: 'Negotiating' },
      { stage: FunnelStage.CLOSED_WON, label: 'Closed Won' },
    ];

    let previousCount = total;
    const funnelData = funnelStages.map((s, index) => {
      const count = stageCounts[s.stage];
      const percentage = Math.round((count / total) * 100 * 10) / 10;
      const dropOff =
        index > 0
          ? Math.round(((previousCount - count) / previousCount) * 100 * 10) /
            10
          : 0;

      previousCount = count || previousCount;

      return {
        stage: s.stage,
        label: s.label,
        count,
        percentage,
        dropOff,
      };
    });

    // Find bottleneck (biggest drop-off)
    let bottleneck = '';
    let maxDropOff = 0;
    for (let i = 1; i < funnelData.length - 1; i++) {
      if (funnelData[i].dropOff > maxDropOff) {
        maxDropOff = funnelData[i].dropOff;
        bottleneck = `${funnelData[i - 1].label} → ${funnelData[i].label}`;
      }
    }

    // Calculate avg time to close
    const closedWon = funnels.filter(
      (f) => f.currentStage === FunnelStage.CLOSED_WON,
    );
    let avgTimeMinutes = 0;
    let countWithTime = 0;

    for (const funnel of closedWon) {
      const startTime = funnel.blastSentAt || funnel.createdAt;
      if (funnel.closedAt) {
        const duration =
          (funnel.closedAt.getTime() - startTime.getTime()) / (1000 * 60);
        avgTimeMinutes += duration;
        countWithTime++;
      }
    }

    const avgTimeToClose =
      countWithTime > 0
        ? this.formatDuration(avgTimeMinutes / countWithTime)
        : 'N/A';

    // Get blast info if filtered
    let blastInfo: { id: string; name: string; sentAt: Date } | null = null;
    if (query.blastId) {
      const blast = await this.blastRepository.findOne({
        where: { id: query.blastId },
        select: ['id', 'name', 'createdAt'],
      });
      if (blast) {
        blastInfo = {
          id: blast.id,
          name: blast.name,
          sentAt: blast.createdAt,
        };
      }
    }

    // Calculate revenue
    const totalRevenue = closedWon.reduce(
      (sum, f) => sum + (Number(f.dealValue) || 0),
      0,
    );

    return {
      period: query.period || AnalyticsPeriod.LAST_7_DAYS,
      dateRange: {
        start: dateRange.startDate,
        end: dateRange.endDate,
      },
      blast: blastInfo,
      funnel: funnelData,
      closedLost: stageCounts[FunnelStage.CLOSED_LOST],
      bottleneck: bottleneck || 'N/A',
      avgTimeToClose,
      totalRevenue,
      conversionRate:
        Math.round((stageCounts[FunnelStage.CLOSED_WON] / total) * 100 * 10) /
        10,
    };
  }

  // ==================== Unreplied Conversations ====================

  async getUnrepliedConversations(userId: string, query: UnrepliedQueryDto) {
    const { page = 1, limit = 20, minWaitingHours = 0 } = query;

    // Find conversations where last message is incoming and not replied
    const subQuery = this.chatMessageRepository
      .createQueryBuilder('sub')
      .select('sub.phoneNumber', 'phoneNumber')
      .addSelect('MAX(sub.timestamp)', 'lastTimestamp')
      .where('sub.userId = :userId', { userId })
      .groupBy('sub.phoneNumber');

    const qb = this.chatMessageRepository
      .createQueryBuilder('msg')
      .innerJoin(
        `(${subQuery.getQuery()})`,
        'latest',
        'msg.phoneNumber = latest."phoneNumber" AND msg.timestamp = latest."lastTimestamp"',
      )
      .setParameters(subQuery.getParameters())
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.direction = :direction', {
        direction: ChatMessageDirection.INCOMING,
      });

    // Filter by minimum waiting hours
    if (minWaitingHours > 0) {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - minWaitingHours);
      qb.andWhere('msg.timestamp < :cutoffTime', { cutoffTime });
    }

    qb.orderBy('msg.timestamp', 'ASC'); // Oldest first (most urgent)

    const total = await qb.getCount();

    const messages = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get lead scores for these phone numbers
    const phoneNumbers = messages.map((m) => m.phoneNumber);
    const leadScores =
      phoneNumbers.length > 0
        ? await this.leadScoreRepository.find({
            where: { userId, phoneNumber: In(phoneNumbers) },
            select: ['phoneNumber', 'score'],
          })
        : [];

    const leadScoreMap = new Map(
      leadScores.map((l) => [l.phoneNumber, l.score]),
    );

    // Get funnel stages
    const funnels =
      phoneNumbers.length > 0
        ? await this.funnelRepository.find({
            where: { userId, phoneNumber: In(phoneNumbers) },
            select: ['phoneNumber', 'currentStage'],
          })
        : [];

    const funnelMap = new Map(
      funnels.map((f) => [f.phoneNumber, f.currentStage]),
    );

    const data = messages.map((msg) => {
      const waitingMs = Date.now() - msg.timestamp.getTime();
      const waitingHours = Math.round((waitingMs / (1000 * 60 * 60)) * 10) / 10;
      const leadScore =
        leadScoreMap.get(msg.phoneNumber) || LeadScoreLevel.COLD;
      const funnelStage = funnelMap.get(msg.phoneNumber);

      // Calculate priority
      let priority: 'high' | 'medium' | 'low' = 'low';
      if (leadScore === LeadScoreLevel.HOT && waitingHours >= 1) {
        priority = 'high';
      } else if (leadScore === LeadScoreLevel.WARM || waitingHours >= 4) {
        priority = 'medium';
      }

      return {
        phoneNumber: msg.phoneNumber,
        lastMessage: msg.body?.substring(0, 100) || '[media]',
        lastMessageAt: msg.timestamp,
        waitingTime: this.formatDuration(waitingMs / (1000 * 60)),
        waitingHours,
        funnelStage: funnelStage || null,
        leadScore,
        priority,
      };
    });

    // Sort by priority then waiting time
    data.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.waitingHours - a.waitingHours;
    });

    const urgentCount = data.filter((d) => d.priority === 'high').length;

    return {
      data,
      total,
      page,
      limit,
      urgentCount,
    };
  }

  // ==================== Conversation List ====================

  async getConversationList(userId: string, query: ConversationListQueryDto) {
    const { page = 1, limit = 20, stage, blastId, search } = query;

    const qb = this.funnelRepository
      .createQueryBuilder('funnel')
      .where('funnel.userId = :userId', { userId });

    if (stage) {
      qb.andWhere('funnel.currentStage = :stage', { stage });
    }

    if (blastId) {
      qb.andWhere('funnel.blastId = :blastId', { blastId });
    }

    if (search) {
      qb.andWhere('funnel.phoneNumber LIKE :search', { search: `%${search}%` });
    }

    qb.orderBy('funnel.updatedAt', 'DESC');

    const total = await qb.getCount();

    const funnels = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get lead scores and contacts
    const phoneNumbers = funnels.map((f) => f.phoneNumber);

    const [leadScores, contacts] = await Promise.all([
      phoneNumbers.length > 0
        ? this.leadScoreRepository.find({
            where: { userId, phoneNumber: In(phoneNumbers) },
            select: ['phoneNumber', 'score'],
          })
        : [],
      phoneNumbers.length > 0
        ? this.contactRepository.find({
            where: { userId, phoneNumber: In(phoneNumbers) },
            select: ['phoneNumber', 'name', 'waName'],
          })
        : [],
    ]);

    const leadScoreMap = new Map<string, LeadScoreLevel>(
      leadScores.map((l) => [l.phoneNumber, l.score] as const),
    );
    const contactMap = new Map<string, { name?: string; waName?: string }>(
      contacts.map(
        (c) => [c.phoneNumber, { name: c.name, waName: c.waName }] as const,
      ),
    );

    const data = funnels.map((funnel) => {
      const contact = contactMap.get(funnel.phoneNumber);
      // Priority: funnel.contactName > contact.name > contact.waName
      const displayName =
        funnel.contactName || contact?.name || contact?.waName || null;

      return {
        id: funnel.id,
        phoneNumber: funnel.phoneNumber,
        contactName: contact?.name || null,
        pushName: contact?.waName || null,
        displayName,
        currentStage: funnel.currentStage,
        leadScore: leadScoreMap.get(funnel.phoneNumber) || LeadScoreLevel.COLD,
        blastId: funnel.blastId,
        blastName: funnel.blastName,
        dealValue: funnel.dealValue ? Number(funnel.dealValue) : null,
        isAnalyzed: funnel.isAnalyzed,
        createdAt: funnel.createdAt,
        updatedAt: funnel.updatedAt,
        closedAt: funnel.closedAt,
      };
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  // ==================== Blast Performance ====================

  async getBlastPerformance(userId: string, blastId: string) {
    const blast = await this.blastRepository.findOne({
      where: { id: blastId, userId },
    });

    if (!blast) {
      return null;
    }

    // Get funnel data for this blast
    const funnels = await this.funnelRepository.find({
      where: { userId, blastId },
    });

    // Count stages
    const stageCounts: Record<FunnelStage, number> = {
      [FunnelStage.BLAST_SENT]: 0,
      [FunnelStage.DELIVERED]: 0,
      [FunnelStage.REPLIED]: 0,
      [FunnelStage.INTERESTED]: 0,
      [FunnelStage.NEGOTIATING]: 0,
      [FunnelStage.CLOSED_WON]: 0,
      [FunnelStage.CLOSED_LOST]: 0,
    };

    for (const funnel of funnels) {
      stageCounts[funnel.currentStage]++;
    }

    const total = funnels.length || 1;
    const closedWon = funnels.filter(
      (f) => f.currentStage === FunnelStage.CLOSED_WON,
    );

    // Calculate revenue
    const totalRevenue = closedWon.reduce(
      (sum, f) => sum + (Number(f.dealValue) || 0),
      0,
    );

    // Calculate avg reply time
    let totalReplyTime = 0;
    let replyCount = 0;
    for (const funnel of funnels) {
      if (funnel.blastSentAt && funnel.repliedAt) {
        totalReplyTime +=
          funnel.repliedAt.getTime() - funnel.blastSentAt.getTime();
        replyCount++;
      }
    }

    const avgReplyTime =
      replyCount > 0 ? totalReplyTime / replyCount / (1000 * 60) : null;

    return {
      blast: {
        id: blast.id,
        name: blast.name,
        sentAt: blast.createdAt,
        totalRecipients: total,
      },
      delivery: {
        sent: stageCounts[FunnelStage.BLAST_SENT],
        delivered:
          stageCounts[FunnelStage.DELIVERED] +
          stageCounts[FunnelStage.REPLIED] +
          stageCounts[FunnelStage.INTERESTED] +
          stageCounts[FunnelStage.NEGOTIATING] +
          stageCounts[FunnelStage.CLOSED_WON],
        deliveryRate: Math.round(
          ((total - stageCounts[FunnelStage.BLAST_SENT]) / total) * 100,
        ),
      },
      engagement: {
        replied:
          stageCounts[FunnelStage.REPLIED] +
          stageCounts[FunnelStage.INTERESTED] +
          stageCounts[FunnelStage.NEGOTIATING] +
          stageCounts[FunnelStage.CLOSED_WON] +
          stageCounts[FunnelStage.CLOSED_LOST],
        replyRate: Math.round(
          ((stageCounts[FunnelStage.REPLIED] +
            stageCounts[FunnelStage.INTERESTED] +
            stageCounts[FunnelStage.NEGOTIATING] +
            stageCounts[FunnelStage.CLOSED_WON] +
            stageCounts[FunnelStage.CLOSED_LOST]) /
            total) *
            100,
        ),
        avgReplyTime: avgReplyTime ? this.formatDuration(avgReplyTime) : 'N/A',
      },
      conversion: {
        interested: stageCounts[FunnelStage.INTERESTED],
        negotiating: stageCounts[FunnelStage.NEGOTIATING],
        closedWon: stageCounts[FunnelStage.CLOSED_WON],
        closedLost: stageCounts[FunnelStage.CLOSED_LOST],
        conversionRate:
          Math.round((stageCounts[FunnelStage.CLOSED_WON] / total) * 100 * 10) /
          10,
        revenue: totalRevenue,
      },
    };
  }

  // ==================== Trends ====================

  async getTrends(userId: string, query: AnalyticsQueryDto) {
    const dateRange = this.getDateRange(query);

    // Get daily snapshots or calculate from raw data
    const snapshots = await this.snapshotRepository.find({
      where: {
        userId,
        date: Between(dateRange.startDate, dateRange.endDate),
      },
      order: { date: 'ASC' },
    });

    // If no snapshots, calculate from raw data
    if (snapshots.length === 0) {
      return this.calculateTrendsFromRawData(userId, dateRange);
    }

    const daily = snapshots.map((s) => ({
      date: s.date,
      messagesSent: s.totalMessagesSent,
      messagesReceived: s.totalMessagesReceived,
      newLeads: s.newConversations,
      closedDeals: s.closedDeals,
      revenue: Number(s.totalRevenue),
    }));

    return {
      period: query.period || AnalyticsPeriod.LAST_7_DAYS,
      dateRange: {
        start: dateRange.startDate,
        end: dateRange.endDate,
      },
      daily,
    };
  }

  // ==================== Cron Jobs ====================

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateDailySnapshots() {
    this.logger.log('Starting daily snapshot generation...');

    // Get all users who have chat messages
    const userIds = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('DISTINCT msg.userId', 'userId')
      .getRawMany();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    for (const { userId } of userIds) {
      try {
        await this.generateSnapshotForUser(userId, yesterday, yesterdayEnd);
      } catch (error) {
        this.logger.error(
          `Failed to generate snapshot for user ${userId}: ${error}`,
        );
      }
    }

    this.logger.log('Daily snapshot generation completed');
  }

  // ==================== Helper Methods ====================

  private async generateSnapshotForUser(
    userId: string,
    startDate: Date,
    endDate: Date,
  ) {
    // Check if snapshot already exists
    const existing = await this.snapshotRepository.findOne({
      where: { userId, date: startDate },
    });

    if (existing) {
      return;
    }

    // Calculate metrics
    const [messagesSent, messagesReceived, funnelCounts, leadCounts, revenue] =
      await Promise.all([
        this.chatMessageRepository.count({
          where: {
            userId,
            direction: ChatMessageDirection.OUTGOING,
            timestamp: Between(startDate, endDate),
          },
        }),
        this.chatMessageRepository.count({
          where: {
            userId,
            direction: ChatMessageDirection.INCOMING,
            timestamp: Between(startDate, endDate),
          },
        }),
        this.getFunnelCounts(userId, { startDate, endDate }),
        this.getLeadCounts(userId),
        this.getRevenue(userId, { startDate, endDate }),
      ]);

    const snapshot = this.snapshotRepository.create({
      userId,
      date: startDate,
      totalMessagesSent: messagesSent,
      totalMessagesReceived: messagesReceived,
      funnelCounts,
      leadCounts,
      totalRevenue: revenue.totalValue,
      closedDeals: revenue.totalDeals,
    });

    await this.snapshotRepository.save(snapshot);
  }

  private getDateRange(query: AnalyticsQueryDto): DateRange {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (query.period) {
      case AnalyticsPeriod.TODAY:
        startDate = new Date(now.setHours(0, 0, 0, 0));
        endDate = new Date();
        break;
      case AnalyticsPeriod.YESTERDAY:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
        break;
      case AnalyticsPeriod.LAST_7_DAYS:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case AnalyticsPeriod.LAST_30_DAYS:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
        break;
      case AnalyticsPeriod.THIS_MONTH:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case AnalyticsPeriod.LAST_MONTH:
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case AnalyticsPeriod.CUSTOM:
        startDate = query.startDate
          ? new Date(query.startDate)
          : new Date(now.setDate(now.getDate() - 7));
        endDate = query.endDate ? new Date(query.endDate) : new Date();
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
    }

    return { startDate, endDate };
  }

  private async getActiveConversationsCount(
    userId: string,
    dateRange: DateRange,
  ): Promise<number> {
    const result = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('COUNT(DISTINCT msg.phoneNumber)', 'count')
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.timestamp >= :startDate', {
        startDate: dateRange.startDate,
      })
      .andWhere('msg.timestamp <= :endDate', { endDate: dateRange.endDate })
      .getRawOne();

    return parseInt(result?.count || '0', 10);
  }

  private async getUnrepliedCount(userId: string): Promise<number> {
    // Find conversations where last message is incoming
    const subQuery = this.chatMessageRepository
      .createQueryBuilder('sub')
      .select('sub.phoneNumber', 'phoneNumber')
      .addSelect('MAX(sub.timestamp)', 'lastTimestamp')
      .where('sub.userId = :userId', { userId })
      .groupBy('sub.phoneNumber');

    const result = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .innerJoin(
        `(${subQuery.getQuery()})`,
        'latest',
        'msg.phoneNumber = latest."phoneNumber" AND msg.timestamp = latest."lastTimestamp"',
      )
      .setParameters(subQuery.getParameters())
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.direction = :direction', {
        direction: ChatMessageDirection.INCOMING,
      })
      .getCount();

    return result;
  }

  private async getLeadCounts(userId: string): Promise<LeadCounts> {
    const [hot, warm, cold] = await Promise.all([
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.HOT },
      }),
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.WARM },
      }),
      this.leadScoreRepository.count({
        where: { userId, score: LeadScoreLevel.COLD },
      }),
    ]);

    return { hot, warm, cold };
  }

  private async getFunnelCounts(
    userId: string,
    dateRange: DateRange,
  ): Promise<FunnelCounts> {
    const funnels = await this.funnelRepository.find({
      where: {
        userId,
        createdAt: Between(dateRange.startDate, dateRange.endDate),
      },
      select: ['currentStage'],
    });

    const counts: FunnelCounts = {
      blast_sent: 0,
      delivered: 0,
      replied: 0,
      interested: 0,
      negotiating: 0,
      closed_won: 0,
      closed_lost: 0,
    };

    for (const funnel of funnels) {
      counts[funnel.currentStage]++;
    }

    return counts;
  }

  private async getRevenue(
    userId: string,
    dateRange: DateRange,
  ): Promise<{ totalDeals: number; totalValue: number }> {
    const closedWon = await this.funnelRepository.find({
      where: {
        userId,
        currentStage: FunnelStage.CLOSED_WON,
        closedAt: Between(dateRange.startDate, dateRange.endDate),
      },
      select: ['dealValue'],
    });

    const totalValue = closedWon.reduce(
      (sum, f) => sum + (Number(f.dealValue) || 0),
      0,
    );

    return {
      totalDeals: closedWon.length,
      totalValue,
    };
  }

  private async getAvgResponseTime(
    userId: string,
    dateRange: DateRange,
  ): Promise<number | null> {
    // This is simplified - in production you'd calculate from message pairs
    const funnels = await this.funnelRepository.find({
      where: {
        userId,
        repliedAt: Between(dateRange.startDate, dateRange.endDate),
      },
      select: ['blastSentAt', 'repliedAt'],
    });

    if (funnels.length === 0) {
      return null;
    }

    let totalMinutes = 0;
    let count = 0;

    for (const funnel of funnels) {
      if (funnel.blastSentAt && funnel.repliedAt) {
        const diffMs =
          funnel.repliedAt.getTime() - funnel.blastSentAt.getTime();
        totalMinutes += diffMs / (1000 * 60);
        count++;
      }
    }

    return count > 0 ? totalMinutes / count : null;
  }

  private calculateConversionRate(funnelCounts: FunnelCounts): number {
    const total = Object.values(funnelCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return Math.round((funnelCounts.closed_won / total) * 100 * 10) / 10;
  }

  private async calculateTrendsFromRawData(
    userId: string,
    dateRange: DateRange,
  ) {
    // Group messages by date
    const messages = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('DATE(msg.timestamp)', 'date')
      .addSelect('msg.direction', 'direction')
      .addSelect('COUNT(*)', 'count')
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.timestamp >= :startDate', {
        startDate: dateRange.startDate,
      })
      .andWhere('msg.timestamp <= :endDate', { endDate: dateRange.endDate })
      .groupBy('DATE(msg.timestamp)')
      .addGroupBy('msg.direction')
      .getRawMany();

    // Organize by date
    const dailyMap: Record<string, { sent: number; received: number }> = {};

    for (const row of messages) {
      const dateStr = row.date;
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { sent: 0, received: 0 };
      }
      if (row.direction === ChatMessageDirection.OUTGOING) {
        dailyMap[dateStr].sent = parseInt(row.count, 10);
      } else {
        dailyMap[dateStr].received = parseInt(row.count, 10);
      }
    }

    const daily = Object.entries(dailyMap)
      .map(([date, counts]) => ({
        date,
        messagesSent: counts.sent,
        messagesReceived: counts.received,
        newLeads: 0,
        closedDeals: 0,
        revenue: 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      period: AnalyticsPeriod.CUSTOM,
      dateRange: {
        start: dateRange.startDate,
        end: dateRange.endDate,
      },
      daily,
    };
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    } else if (minutes < 1440) {
      return `${Math.round(minutes / 60)} hours`;
    } else {
      return `${Math.round(minutes / 1440)} days`;
    }
  }
}
