import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationFunnel,
  FunnelStage,
  StageHistoryEntry,
} from '../../../database/entities/conversation-funnel.entity';
import { LeadScoreSettings } from '../../../database/entities/lead-score-settings.entity';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';

// Stage order for progression (can only advance forward)
const STAGE_ORDER: FunnelStage[] = [
  FunnelStage.BLAST_SENT,
  FunnelStage.DELIVERED,
  FunnelStage.REPLIED,
  FunnelStage.INTERESTED,
  FunnelStage.NEGOTIATING,
  FunnelStage.CLOSED_WON,
];

@Injectable()
export class FunnelTrackerService {
  private readonly logger = new Logger(FunnelTrackerService.name);

  // Keywords for auto-detection (configurable per user in future)
  private readonly interestedKeywords = [
    'harga',
    'berapa',
    'ready',
    'ada',
    'mau',
    'info',
    'stock',
    'stok',
    'available',
    'tersedia',
  ];

  private readonly negotiatingKeywords = [
    'diskon',
    'kurang',
    'nego',
    'transfer',
    'bayar',
    'dp',
    'cicil',
    'kredit',
    'ongkir',
    'free ongkir',
  ];

  // Fallback defaults if settings not found
  private readonly defaultClosedWon = ['sudah transfer'];

  private readonly defaultClosedLost = [
    'cancel',
    'batal',
    'gak jadi',
    'skip',
    'tidak jadi',
  ];

  constructor(
    @InjectRepository(ConversationFunnel)
    private readonly funnelRepository: Repository<ConversationFunnel>,
    @InjectRepository(LeadScoreSettings)
    private readonly settingsRepository: Repository<LeadScoreSettings>,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) {}

  /**
   * Called when blast message is created/sent
   */
  async onBlastSent(
    userId: string,
    phoneNumber: string,
    blastId: string,
    blastName: string,
  ): Promise<ConversationFunnel> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    let funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (funnel) {
      // Update existing funnel with new blast info
      funnel.blastId = blastId;
      funnel.blastName = blastName;
      // Don't reset stage if already progressed
      if (funnel.currentStage === FunnelStage.BLAST_SENT) {
        funnel.blastSentAt = new Date();
      }
    } else {
      // Create new funnel entry
      funnel = this.funnelRepository.create({
        userId,
        phoneNumber: normalizedPhone,
        currentStage: FunnelStage.BLAST_SENT,
        blastId,
        blastName,
        blastSentAt: new Date(),
        stageHistory: [
          {
            stage: FunnelStage.BLAST_SENT,
            enteredAt: new Date(),
            trigger: 'auto:blast_created',
          },
        ],
      });
    }

    const saved = await this.funnelRepository.save(funnel);
    this.logger.log(
      `Funnel created/updated for ${normalizedPhone}: BLAST_SENT`,
    );

    return saved;
  }

  /**
   * Called when message is delivered (from WhatsApp receipt)
   */
  async onMessageDelivered(userId: string, phoneNumber: string): Promise<void> {
    await this.advanceStageIfNeeded(
      userId,
      phoneNumber,
      FunnelStage.DELIVERED,
      'auto:delivery_receipt',
    );
  }

  /**
   * Called when incoming message received - main entry point for keyword detection
   */
  async onMessageReceived(
    userId: string,
    phoneNumber: string,
    messageBody: string,
  ): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // First, ensure funnel exists (create if not, for organic conversations)
    let funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!funnel) {
      // Create funnel for organic conversation (not from blast)
      funnel = this.funnelRepository.create({
        userId,
        phoneNumber: normalizedPhone,
        currentStage: FunnelStage.REPLIED,
        repliedAt: new Date(),
        stageHistory: [
          {
            stage: FunnelStage.REPLIED,
            enteredAt: new Date(),
            trigger: 'auto:organic_conversation',
          },
        ],
      });
      await this.funnelRepository.save(funnel);
      this.emitFunnelUpdate(userId, funnel);
      this.logger.log(`Organic funnel created for ${normalizedPhone}: REPLIED`);
    } else {
      // Advance to REPLIED if not already there or beyond
      await this.advanceStageIfNeeded(
        userId,
        normalizedPhone,
        FunnelStage.REPLIED,
        'auto:incoming_message',
      );
    }

    // Then check for keyword-based advancement
    const lowerBody = messageBody.toLowerCase();

    // Get user settings for keywords
    const settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    // Use settings or defaults
    const closingKeywords = settings?.closedWonKeywords?.length
      ? settings.closedWonKeywords
      : this.defaultClosedWon;

    const lostKeywords = settings?.closedLostKeywords?.length
      ? settings.closedLostKeywords
      : this.defaultClosedLost;

    const negotiatingKeywords = this.negotiatingKeywords; // currently hardcoded, can be moved to DB too if needed
    const interestedKeywords = settings?.warmKeywords?.length
      ? settings.warmKeywords
      : this.interestedKeywords; // Reuse warm keywords as 'interested' or keep separate

    // Check closing won keywords first (highest priority)
    for (const kw of closingKeywords) {
      if (lowerBody.includes(kw.toLowerCase())) {
        await this.advanceStageIfNeeded(
          userId,
          normalizedPhone,
          FunnelStage.CLOSED_WON,
          `keyword:${kw}`,
        );
        return;
      }
    }

    // Check closing lost keywords
    for (const kw of lostKeywords) {
      if (lowerBody.includes(kw.toLowerCase())) {
        await this.advanceStageIfNeeded(
          userId,
          normalizedPhone,
          FunnelStage.CLOSED_LOST,
          `keyword:${kw}`,
        );
        return;
      }
    }

    // Check negotiating keywords
    for (const kw of negotiatingKeywords) {
      if (lowerBody.includes(kw.toLowerCase())) {
        await this.advanceStageIfNeeded(
          userId,
          normalizedPhone,
          FunnelStage.NEGOTIATING,
          `keyword:${kw}`,
        );
        return;
      }
    }

    // Check interested keywords
    for (const kw of interestedKeywords) {
      if (lowerBody.includes(kw.toLowerCase())) {
        await this.advanceStageIfNeeded(
          userId,
          normalizedPhone,
          FunnelStage.INTERESTED,
          `keyword:${kw}`,
        );
        return;
      }
    }
  }

  /**
   * Manual stage update (from API)
   */
  async updateStageManual(
    userId: string,
    phoneNumber: string,
    newStage: FunnelStage,
    options?: { dealValue?: number; reason?: string },
  ): Promise<ConversationFunnel> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    let funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!funnel) {
      // Create new funnel at the specified stage
      funnel = this.funnelRepository.create({
        userId,
        phoneNumber: normalizedPhone,
        currentStage: newStage,
        stageHistory: [
          {
            stage: newStage,
            enteredAt: new Date(),
            trigger: 'manual',
          },
        ],
      });
    } else {
      funnel.currentStage = newStage;
      funnel.stageHistory.push({
        stage: newStage,
        enteredAt: new Date(),
        trigger: 'manual',
      });
    }

    // Set timestamp based on stage
    this.setStageTimestamp(funnel, newStage);

    // Set deal value and reason for closing stages
    if (
      newStage === FunnelStage.CLOSED_WON ||
      newStage === FunnelStage.CLOSED_LOST
    ) {
      funnel.closedAt = new Date();
      if (options?.dealValue !== undefined) {
        funnel.dealValue = options.dealValue;
      }
      if (options?.reason) {
        funnel.closedReason = options.reason;
      }
    }

    const saved = await this.funnelRepository.save(funnel);
    this.emitFunnelUpdate(userId, saved);

    this.logger.log(
      `Funnel manually updated for ${normalizedPhone}: ${newStage}`,
    );

    return saved;
  }

  /**
   * Get funnel by phone number
   */
  async getFunnel(
    userId: string,
    phoneNumber: string,
  ): Promise<ConversationFunnel | null> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    return this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });
  }

  /**
   * Advance stage only if new stage is higher in the funnel
   */
  private async advanceStageIfNeeded(
    userId: string,
    phoneNumber: string,
    newStage: FunnelStage,
    trigger: string,
  ): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!funnel) {
      this.logger.debug(
        `No funnel found for ${normalizedPhone}, skipping stage advance`,
      );
      return;
    }

    const currentIndex = STAGE_ORDER.indexOf(funnel.currentStage);
    const newIndex = STAGE_ORDER.indexOf(newStage);

    // Handle CLOSED_LOST separately (it's not in the normal progression)
    if (newStage === FunnelStage.CLOSED_LOST) {
      funnel.currentStage = newStage;
      funnel.closedAt = new Date();
      funnel.stageHistory.push({
        stage: newStage,
        enteredAt: new Date(),
        trigger,
      });
      await this.funnelRepository.save(funnel);
      this.emitFunnelUpdate(userId, funnel);
      return;
    }

    // Only advance if new stage is higher
    if (newIndex > currentIndex) {
      funnel.currentStage = newStage;
      funnel.stageHistory.push({
        stage: newStage,
        enteredAt: new Date(),
        trigger,
      });

      // Set timestamp based on stage
      this.setStageTimestamp(funnel, newStage);

      await this.funnelRepository.save(funnel);
      this.emitFunnelUpdate(userId, funnel);

      this.logger.log(
        `Funnel advanced for ${normalizedPhone}: ${STAGE_ORDER[currentIndex]} → ${newStage} (${trigger})`,
      );
    }
  }

  /**
   * Set the appropriate timestamp for a stage
   */
  private setStageTimestamp(
    funnel: ConversationFunnel,
    stage: FunnelStage,
  ): void {
    const now = new Date();

    switch (stage) {
      case FunnelStage.BLAST_SENT:
        funnel.blastSentAt = now;
        break;
      case FunnelStage.DELIVERED:
        funnel.deliveredAt = now;
        break;
      case FunnelStage.REPLIED:
        funnel.repliedAt = now;
        break;
      case FunnelStage.INTERESTED:
        funnel.interestedAt = now;
        break;
      case FunnelStage.NEGOTIATING:
        funnel.negotiatingAt = now;
        break;
      case FunnelStage.CLOSED_WON:
      case FunnelStage.CLOSED_LOST:
        funnel.closedAt = now;
        break;
    }
  }

  /**
   * Emit WebSocket event for funnel update
   */
  private emitFunnelUpdate(userId: string, funnel: ConversationFunnel): void {
    this.whatsAppGateway.server.to(`user:${userId}`).emit('funnel:update', {
      phoneNumber: funnel.phoneNumber,
      currentStage: funnel.currentStage,
      stageHistory: funnel.stageHistory,
      blastId: funnel.blastId,
      blastName: funnel.blastName,
      updatedAt: new Date(),
    });
  }

  /**
   * Mark stale conversations as CLOSED_LOST
   * Called by cron job
   */
  async markStaleConversationsAsLost(staleDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - staleDays);

    // Find funnels that are not closed and haven't been updated in staleDays
    const staleFunnels = await this.funnelRepository
      .createQueryBuilder('funnel')
      .where('funnel.currentStage NOT IN (:...closedStages)', {
        closedStages: [FunnelStage.CLOSED_WON, FunnelStage.CLOSED_LOST],
      })
      .andWhere('funnel.updatedAt < :cutoffDate', { cutoffDate })
      .getMany();

    let markedCount = 0;

    for (const funnel of staleFunnels) {
      funnel.currentStage = FunnelStage.CLOSED_LOST;
      funnel.closedAt = new Date();
      funnel.closedReason = `no_activity_${staleDays}_days`;
      funnel.stageHistory.push({
        stage: FunnelStage.CLOSED_LOST,
        enteredAt: new Date(),
        trigger: `auto:stale_${staleDays}_days`,
      });

      await this.funnelRepository.save(funnel);
      this.emitFunnelUpdate(funnel.userId, funnel);
      markedCount++;
    }

    if (markedCount > 0) {
      this.logger.log(
        `Marked ${markedCount} stale conversations as CLOSED_LOST`,
      );
    }

    return markedCount;
  }

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    if (
      cleaned.startsWith('62') &&
      cleaned.length > 13 &&
      cleaned.endsWith('0')
    ) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }
}
