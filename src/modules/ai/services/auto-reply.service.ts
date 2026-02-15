import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AiSettings,
  AutoReplyStatus,
} from '../../../database/entities/ai-settings.entity';
import { AutoReplyBlacklist } from '../../../database/entities/auto-reply-blacklist.entity';
import { AutoReplyLog } from '../../../database/entities/auto-reply-log.entity';
import { BlastMessage } from '../../../database/entities/blast.entity';
import { AiFeatureType } from '../../../database/entities/ai-token-usage.entity';
import { AiService } from '../ai.service';
import { AiTokenService } from './ai-token.service';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { ChatsService } from '../../chats/chats.service';
import {
  UpdateAutoReplySettingsDto,
  AddBlacklistDto,
  AutoReplyLogQueryDto,
} from '../dto/auto-reply.dto';
import type { MediaData } from '../../whatsapp/adapters/whatsapp-client.interface';

interface SkipResult {
  shouldSkip: boolean;
  reason?: string;
}

@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);

  constructor(
    @InjectRepository(AiSettings)
    private readonly settingsRepository: Repository<AiSettings>,
    @InjectRepository(AutoReplyBlacklist)
    private readonly blacklistRepository: Repository<AutoReplyBlacklist>,
    @InjectRepository(AutoReplyLog)
    private readonly logRepository: Repository<AutoReplyLog>,
    @InjectRepository(BlastMessage)
    private readonly blastMessageRepository: Repository<BlastMessage>,
    @InjectQueue('auto-reply')
    private readonly autoReplyQueue: Queue,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => AiTokenService))
    private readonly aiTokenService: AiTokenService,
    private readonly whatsAppGateway: WhatsAppGateway,
    @Inject(forwardRef(() => ChatsService))
    private readonly chatsService: ChatsService,
  ) {}

  /**
   * Entry point: handle incoming message for auto-reply
   * Now supports both text and image messages
   */
  async handleIncomingMessage(
    userId: string,
    phoneNumber: string,
    messageId: string,
    messageBody: string,
    downloadMedia?: () => Promise<MediaData | null>,
  ): Promise<void> {
    // Normalize phone number
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    this.logger.debug(
      `[AUTO-REPLY] Checking message from ${normalizedPhone} for user ${userId} (hasMedia: ${!!downloadMedia})`,
    );

    // Download media FIRST (before skip check) so we know the correct token cost
    let mediaData: MediaData | null = null;
    if (downloadMedia) {
      try {
        mediaData = await downloadMedia();
        if (mediaData) {
          this.logger.debug(
            `[AUTO-REPLY] Downloaded media: ${mediaData.mimetype}, size: ${Math.round((mediaData.data?.length || 0) / 1024)}KB`,
          );
        }
      } catch (err) {
        this.logger.warn(`[AUTO-REPLY] Failed to download media: ${err}`);
      }
    }

    // Check if should skip (pass hasImage for correct token cost check)
    const hasImage = !!mediaData && this.isImageMimetype(mediaData.mimetype);
    const skipResult = await this.shouldSkip(userId, normalizedPhone, hasImage);

    if (skipResult.shouldSkip) {
      this.logger.debug(
        `[AUTO-REPLY] Skipping for ${normalizedPhone}: ${skipResult.reason}`,
      );

      // Log skipped message
      const log = this.logRepository.create({
        userId,
        phoneNumber: normalizedPhone,
        incomingMessageId: messageId,
        incomingMessageBody: messageBody,
        hasMedia: hasImage,
        mediaMimetype: mediaData?.mimetype || null,
        status: AutoReplyStatus.SKIPPED,
        skipReason: skipResult.reason,
      });
      await this.logRepository.save(log);

      // Emit skipped event
      this.whatsAppGateway.sendAutoReplySkipped(userId, {
        phoneNumber: normalizedPhone,
        reason: skipResult.reason || 'unknown',
      });

      return;
    }

    // Get settings for delay
    const settings = await this.getSettings(userId);
    const delay = this.calculateDelay(
      settings.autoReplyDelayMin,
      settings.autoReplyDelayMax,
    );

    // Create log entry
    const log = this.logRepository.create({
      userId,
      phoneNumber: normalizedPhone,
      incomingMessageId: messageId,
      incomingMessageBody: messageBody,
      hasMedia: !!mediaData,
      mediaMimetype: mediaData?.mimetype || null,
      status: AutoReplyStatus.QUEUED,
      delaySeconds: delay,
    });
    const savedLog = await this.logRepository.save(log);

    // Queue the auto-reply job with delay
    // Note: We pass media base64 data in the job - this works for images up to ~10MB
    await this.autoReplyQueue.add(
      'send-auto-reply',
      {
        logId: savedLog.id,
        userId,
        phoneNumber: normalizedPhone,
        messageBody,
        mediaData: mediaData
          ? {
              mimetype: mediaData.mimetype,
              data: mediaData.data, // base64
            }
          : null,
      },
      {
        delay: delay * 1000, // Convert to milliseconds
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000,
        },
      },
    );

    this.logger.log(
      `[AUTO-REPLY] Queued reply for ${normalizedPhone} with ${delay}s delay${mediaData ? ' (with image)' : ''}`,
    );
  }

  /**
   * Check if auto-reply should be skipped for this message
   * @param hasImage - Whether message contains an image (affects token cost)
   */
  async shouldSkip(
    userId: string,
    phoneNumber: string,
    hasImage: boolean = false,
  ): Promise<SkipResult> {
    // 1. Check if auto-reply is enabled
    const settings = await this.getSettings(userId);
    if (!settings.autoReplyEnabled) {
      return { shouldSkip: true, reason: 'disabled' };
    }

    // 2. Check AI token balance (dynamic pricing based on current config)
    // Estimate Gemini tokens: Text ~900, Image ~2500
    // Platform tokens = Gemini tokens / divisor (from active pricing)
    const estimatedGeminiTokens = hasImage ? 2500 : 900;
    const minTokensRequired = await this.aiTokenService.calculateMinTokensRequired(estimatedGeminiTokens);

    const tokenBalance = await this.aiTokenService.checkBalance(
      userId,
      minTokensRequired,
    );
    if (!tokenBalance.hasEnough) {
      return { shouldSkip: true, reason: 'insufficient_tokens' };
    }

    // 3. Check working hours
    if (settings.workingHoursEnabled) {
      if (!this.isWithinWorkingHours(settings)) {
        return { shouldSkip: true, reason: 'outside_hours' };
      }
    }

    // 4. Check blacklist
    const isBlacklisted = await this.isBlacklisted(userId, phoneNumber);
    if (isBlacklisted) {
      return { shouldSkip: true, reason: 'blacklisted' };
    }

    // 5. Check cooldown
    const isInCooldown = await this.isInCooldown(
      userId,
      phoneNumber,
      settings.autoReplyCooldownMinutes,
    );
    if (isInCooldown) {
      return { shouldSkip: true, reason: 'cooldown' };
    }

    return { shouldSkip: false };
  }

  private isImageMimetype(mimetype: string): boolean {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
      mimetype,
    );
  }

  /**
   * Process auto-reply (called by processor)
   * @param logId - The auto-reply log ID
   * @param mediaData - Optional image data for vision-based replies
   */
  async processAutoReply(
    logId: string,
    mediaData?: { mimetype: string; data: string },
  ): Promise<void> {
    const log = await this.logRepository.findOne({ where: { id: logId } });

    if (!log) {
      this.logger.warn(`[AUTO-REPLY] Log not found: ${logId}`);
      return;
    }

    if (log.status !== AutoReplyStatus.QUEUED) {
      this.logger.warn(`[AUTO-REPLY] Log ${logId} is not in QUEUED status`);
      return;
    }

    const { userId, phoneNumber, incomingMessageBody } = log;

    try {
      // Generate AI reply
      const settings = await this.getSettings(userId);
      let replyMessage: string;

      this.logger.debug(
        `[AUTO-REPLY] Generating reply for "${incomingMessageBody?.substring(0, 50)}..."${mediaData ? ' (with image)' : ''}`,
      );

      let platformTokensUsed = 0;

      try {
        const suggestions = await this.aiService.generateSuggestions(userId, {
          phoneNumber,
          message: incomingMessageBody || '',
          imageData: mediaData, // Pass image data for vision analysis
        });

        // Use the first suggestion
        replyMessage = suggestions.suggestions[0];
        platformTokensUsed = suggestions.tokenUsage.platformTokens;

        this.logger.debug(
          `[AUTO-REPLY] AI generated: "${replyMessage?.substring(0, 50)}..." (${platformTokensUsed} tokens)`,
        );
      } catch (aiError: any) {
        this.logger.error(`[AUTO-REPLY] AI generation failed: ${aiError?.message || aiError}`);
        this.logger.error(`[AUTO-REPLY] Error details: ${JSON.stringify(aiError)}`);

        // Use fallback message
        if (settings.autoReplyFallbackMessage) {
          this.logger.warn(`[AUTO-REPLY] Using fallback message`);
          replyMessage = settings.autoReplyFallbackMessage;
          platformTokensUsed = 0; // No tokens used for fallback
        } else {
          throw aiError;
        }
      }

      // Send message via ChatsService (stores in ChatMessage automatically)
      const chatMessage = await this.chatsService.sendTextMessage(
        userId,
        phoneNumber,
        replyMessage,
      );

      // Update log
      log.status = AutoReplyStatus.SENT;
      log.replyMessage = replyMessage;
      log.whatsappMessageId = chatMessage.whatsappMessageId || null;
      log.sentAt = new Date();
      await this.logRepository.save(log);

      // Use AI tokens (dynamic pricing based on actual Gemini usage)
      if (platformTokensUsed > 0) {
        const featureType = mediaData
          ? AiFeatureType.AUTO_REPLY_IMAGE
          : AiFeatureType.AUTO_REPLY;

        await this.aiTokenService.useTokens(
          userId,
          featureType,
          platformTokensUsed, // Dynamic amount based on actual usage
          log.id,
        );

        this.logger.debug(
          `[AUTO-REPLY] Deducted ${platformTokensUsed} tokens for ${featureType}`,
        );
      }

      // Emit sent event
      this.whatsAppGateway.sendAutoReplySent(userId, {
        phoneNumber,
        message: replyMessage,
        sentAt: log.sentAt,
        hasImage: !!mediaData,
      });

      this.logger.log(
        `[AUTO-REPLY] Sent reply to ${phoneNumber}${mediaData ? ' (with image)' : ''}: "${replyMessage.substring(0, 50)}..."`,
      );
    } catch (error) {
      this.logger.error(
        `[AUTO-REPLY] Failed for ${phoneNumber}: ${error.message}`,
      );

      log.status = AutoReplyStatus.FAILED;
      log.skipReason = error.message;
      await this.logRepository.save(log);

      // Re-throw to let BullMQ handle retry
      throw error;
    }
  }

  // ==================== Settings ====================

  async getSettings(userId: string): Promise<AiSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      settings = this.settingsRepository.create({
        userId,
        autoReplyEnabled: false,
      });
      await this.settingsRepository.save(settings);
    }

    return settings;
  }

  async getAutoReplySettings(userId: string): Promise<{
    autoReplyEnabled: boolean;
    workingHoursStart: string | null;
    workingHoursEnd: string | null;
    workingHoursEnabled: boolean;
    autoReplyDelayMin: number;
    autoReplyDelayMax: number;
    autoReplyCooldownMinutes: number;
    autoReplyFallbackMessage: string | null;
  }> {
    const settings = await this.getSettings(userId);

    return {
      autoReplyEnabled: settings.autoReplyEnabled,
      workingHoursStart: settings.workingHoursStart,
      workingHoursEnd: settings.workingHoursEnd,
      workingHoursEnabled: settings.workingHoursEnabled,
      autoReplyDelayMin: settings.autoReplyDelayMin,
      autoReplyDelayMax: settings.autoReplyDelayMax,
      autoReplyCooldownMinutes: settings.autoReplyCooldownMinutes,
      autoReplyFallbackMessage: settings.autoReplyFallbackMessage,
    };
  }

  async updateAutoReplySettings(
    userId: string,
    dto: UpdateAutoReplySettingsDto,
  ): Promise<AiSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      settings = this.settingsRepository.create({
        userId,
        ...dto,
      });
    } else {
      Object.assign(settings, dto);
    }

    // Validate delay min <= max
    if (
      dto.autoReplyDelayMin !== undefined &&
      dto.autoReplyDelayMax !== undefined
    ) {
      if (dto.autoReplyDelayMin > dto.autoReplyDelayMax) {
        settings.autoReplyDelayMax = dto.autoReplyDelayMin;
      }
    }

    return this.settingsRepository.save(settings);
  }

  // ==================== Blacklist ====================

  async addToBlacklist(userId: string, dto: AddBlacklistDto): Promise<AutoReplyBlacklist> {
    const normalizedPhone = this.normalizePhoneNumber(dto.phoneNumber);

    // Check if already exists
    const existing = await this.blacklistRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (existing) {
      // Update reason if provided
      if (dto.reason) {
        existing.reason = dto.reason;
        return this.blacklistRepository.save(existing);
      }
      return existing;
    }

    const blacklist = this.blacklistRepository.create({
      userId,
      phoneNumber: normalizedPhone,
      reason: dto.reason,
    });

    return this.blacklistRepository.save(blacklist);
  }

  async removeFromBlacklist(userId: string, phoneNumber: string): Promise<boolean> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const result = await this.blacklistRepository.delete({
      userId,
      phoneNumber: normalizedPhone,
    });

    return (result.affected || 0) > 0;
  }

  async getBlacklist(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: AutoReplyBlacklist[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [data, total] = await this.blacklistRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async isBlacklisted(userId: string, phoneNumber: string): Promise<boolean> {
    const count = await this.blacklistRepository.count({
      where: { userId, phoneNumber },
    });
    return count > 0;
  }

  // ==================== Logs ====================

  async getLogs(
    userId: string,
    query: AutoReplyLogQueryDto,
  ): Promise<{
    data: AutoReplyLog[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 20, phoneNumber, status } = query;

    const qb = this.logRepository.createQueryBuilder('log');
    qb.where('log.userId = :userId', { userId });

    if (phoneNumber) {
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      qb.andWhere('log.phoneNumber = :phoneNumber', {
        phoneNumber: normalizedPhone,
      });
    }

    if (status) {
      qb.andWhere('log.status = :status', { status });
    }

    qb.orderBy('log.queuedAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  // ==================== Helpers ====================

  private isWithinWorkingHours(settings: AiSettings): boolean {
    if (!settings.workingHoursStart || !settings.workingHoursEnd) {
      return true; // No hours set, allow all
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const start = settings.workingHoursStart;
    const end = settings.workingHoursEnd;

    // Handle overnight hours (e.g., 22:00 - 06:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }

    return currentTime >= start && currentTime <= end;
  }

  private async isInCooldown(
    userId: string,
    phoneNumber: string,
    cooldownMinutes: number,
  ): Promise<boolean> {
    // 0 = no cooldown, always allow
    if (cooldownMinutes === 0) {
      return false;
    }

    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - cooldownMinutes);

    const recentReply = await this.logRepository.findOne({
      where: {
        userId,
        phoneNumber,
        status: AutoReplyStatus.SENT,
        sentAt: MoreThan(cutoffTime),
      },
      order: { sentAt: 'DESC' },
    });

    return !!recentReply;
  }

  private calculateDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    // Strip trailing '0' for Indonesian numbers longer than 13 digits
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
