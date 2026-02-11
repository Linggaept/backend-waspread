import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  FollowupCampaign,
  FollowupTrigger,
  FollowupStatus,
  FollowupStep,
} from '../../database/entities/followup-campaign.entity';
import {
  FollowupMessage,
  FollowupMessageStatus,
} from '../../database/entities/followup-message.entity';
import {
  Blast,
  BlastMessage,
  BlastStatus,
  MessageStatus,
} from '../../database/entities/blast.entity';
import { BlastReply } from '../../database/entities/blast-reply.entity';
import {
  ConversationFunnel,
  FunnelStage,
} from '../../database/entities/conversation-funnel.entity';
import {
  CreateFollowupDto,
  UpdateFollowupDto,
  FollowupQueryDto,
  FollowupMessageQueryDto,
  FollowupStatsDto,
} from './dto';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';

@Injectable()
export class FollowupsService {
  private readonly logger = new Logger(FollowupsService.name);

  constructor(
    @InjectRepository(FollowupCampaign)
    private readonly campaignRepository: Repository<FollowupCampaign>,
    @InjectRepository(FollowupMessage)
    private readonly messageRepository: Repository<FollowupMessage>,
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(BlastMessage)
    private readonly blastMessageRepository: Repository<BlastMessage>,
    @InjectRepository(BlastReply)
    private readonly blastReplyRepository: Repository<BlastReply>,
    @InjectRepository(ConversationFunnel)
    private readonly funnelRepository: Repository<ConversationFunnel>,
    private readonly whatsappGateway: WhatsAppGateway,
  ) {}

  /**
   * Create a new follow-up campaign
   */
  async create(
    userId: string,
    dto: CreateFollowupDto,
  ): Promise<FollowupCampaign> {
    // Verify blast exists and belongs to user
    const blast = await this.blastRepository.findOne({
      where: { id: dto.originalBlastId, userId },
    });

    if (!blast) {
      throw new NotFoundException('Original blast campaign not found');
    }

    // Verify blast is completed
    if (blast.status !== BlastStatus.COMPLETED) {
      throw new BadRequestException(
        'Follow-up can only be created for completed blast campaigns',
      );
    }

    // Validate message steps
    const sortedMessages = [...dto.messages].sort((a, b) => a.step - b.step);
    for (let i = 0; i < sortedMessages.length; i++) {
      if (sortedMessages[i].step !== i + 1) {
        throw new BadRequestException(
          `Message steps must be sequential starting from 1. Found step ${sortedMessages[i].step} at position ${i + 1}`,
        );
      }
    }

    // Ensure maxFollowups matches the number of message steps
    if (dto.maxFollowups > sortedMessages.length) {
      throw new BadRequestException(
        `maxFollowups (${dto.maxFollowups}) cannot exceed number of message steps (${sortedMessages.length})`,
      );
    }

    const campaign = this.campaignRepository.create({
      userId,
      name: dto.name,
      originalBlastId: dto.originalBlastId,
      trigger: dto.trigger,
      delayHours: dto.delayHours,
      messages: sortedMessages as FollowupStep[],
      maxFollowups: dto.maxFollowups,
      isActive: true,
      status: FollowupStatus.ACTIVE,
    });

    const saved = await this.campaignRepository.save(campaign);

    this.logger.log(
      `Follow-up campaign created: ${saved.id} for blast ${dto.originalBlastId}`,
    );

    // Emit WebSocket event
    this.whatsappGateway.server.to(`user:${userId}`).emit('followup:created', {
      campaignId: saved.id,
      name: saved.name,
      originalBlastId: saved.originalBlastId,
    });

    return saved;
  }

  /**
   * Get all follow-up campaigns for a user
   */
  async findAll(
    userId: string,
    query: FollowupQueryDto,
  ): Promise<{ data: FollowupCampaign[]; total: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.originalBlast', 'blast')
      .where('campaign.userId = :userId', { userId });

    if (query.search) {
      qb.andWhere('campaign.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    if (query.status) {
      qb.andWhere('campaign.status = :status', { status: query.status });
    }

    qb.orderBy('campaign.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  /**
   * Get a specific follow-up campaign
   */
  async findOne(userId: string, id: string): Promise<FollowupCampaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id, userId },
      relations: ['originalBlast'],
    });

    if (!campaign) {
      throw new NotFoundException('Follow-up campaign not found');
    }

    return campaign;
  }

  /**
   * Update a follow-up campaign
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateFollowupDto,
  ): Promise<FollowupCampaign> {
    const campaign = await this.findOne(userId, id);

    if (dto.name) campaign.name = dto.name;
    if (dto.status) campaign.status = dto.status;
    if (dto.isActive !== undefined) campaign.isActive = dto.isActive;
    if (dto.delayHours) campaign.delayHours = dto.delayHours;
    if (dto.maxFollowups) campaign.maxFollowups = dto.maxFollowups;

    if (dto.messages) {
      const sortedMessages = [...dto.messages].sort((a, b) => a.step - b.step);
      for (let i = 0; i < sortedMessages.length; i++) {
        if (sortedMessages[i].step !== i + 1) {
          throw new BadRequestException(
            `Message steps must be sequential starting from 1`,
          );
        }
      }
      campaign.messages = sortedMessages as FollowupStep[];
    }

    const saved = await this.campaignRepository.save(campaign);

    this.logger.log(`Follow-up campaign updated: ${id}`);

    return saved;
  }

  /**
   * Delete a follow-up campaign
   */
  async delete(userId: string, id: string): Promise<void> {
    const campaign = await this.findOne(userId, id);

    // Cancel all scheduled messages first
    await this.messageRepository.update(
      {
        followupCampaignId: id,
        status: In([
          FollowupMessageStatus.SCHEDULED,
          FollowupMessageStatus.QUEUED,
        ]),
      },
      { status: FollowupMessageStatus.CANCELLED },
    );

    await this.campaignRepository.remove(campaign);

    this.logger.log(`Follow-up campaign deleted: ${id}`);
  }

  /**
   * Get messages for a follow-up campaign
   */
  async getMessages(
    userId: string,
    campaignId: string,
    query: FollowupMessageQueryDto,
  ): Promise<{ data: FollowupMessage[]; total: number }> {
    // Verify campaign belongs to user
    await this.findOne(userId, campaignId);

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.messageRepository
      .createQueryBuilder('message')
      .where('message.followupCampaignId = :campaignId', { campaignId });

    if (query.status) {
      qb.andWhere('message.status = :status', { status: query.status });
    }

    qb.orderBy('message.scheduledAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  /**
   * Get follow-up statistics for a user
   */
  async getStats(userId: string): Promise<FollowupStatsDto> {
    const campaigns = await this.campaignRepository.find({
      where: { userId },
    });

    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(
      (c) => c.status === FollowupStatus.ACTIVE && c.isActive,
    ).length;

    const totalScheduled = campaigns.reduce((sum, c) => sum + c.totalScheduled, 0);
    const totalSent = campaigns.reduce((sum, c) => sum + c.totalSent, 0);
    const totalSkipped = campaigns.reduce((sum, c) => sum + c.totalSkipped, 0);
    const totalFailed = campaigns.reduce((sum, c) => sum + c.totalFailed, 0);
    const totalReplied = campaigns.reduce((sum, c) => sum + c.totalReplied, 0);

    // Conversion rate = (replied / sent) * 100
    const conversionRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    return {
      totalCampaigns,
      activeCampaigns,
      totalScheduled,
      totalSent,
      totalSkipped,
      totalFailed,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }

  /**
   * Check if a recipient should receive follow-up based on trigger condition
   */
  async shouldFollowup(
    userId: string,
    phoneNumber: string,
    originalBlastId: string,
    trigger: FollowupTrigger,
  ): Promise<boolean> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    switch (trigger) {
      case FollowupTrigger.NO_REPLY: {
        // Check if there's any reply from this phone number for this blast
        const hasReply = await this.blastReplyRepository.findOne({
          where: {
            blastId: originalBlastId,
            phoneNumber: normalizedPhone,
          },
        });
        return !hasReply;
      }

      case FollowupTrigger.STAGE_REPLIED:
      case FollowupTrigger.STAGE_INTERESTED:
      case FollowupTrigger.STAGE_NEGOTIATING: {
        // Check funnel stage
        const funnel = await this.funnelRepository.findOne({
          where: {
            userId,
            phoneNumber: normalizedPhone,
          },
        });

        if (!funnel) return false;

        const stageMap: Record<FollowupTrigger, FunnelStage> = {
          [FollowupTrigger.NO_REPLY]: FunnelStage.BLAST_SENT, // Not used here
          [FollowupTrigger.STAGE_REPLIED]: FunnelStage.REPLIED,
          [FollowupTrigger.STAGE_INTERESTED]: FunnelStage.INTERESTED,
          [FollowupTrigger.STAGE_NEGOTIATING]: FunnelStage.NEGOTIATING,
        };

        return funnel.currentStage === stageMap[trigger];
      }

      default:
        return false;
    }
  }

  /**
   * Cancel scheduled follow-ups for a phone number (when they reply)
   */
  async cancelScheduledFollowups(
    phoneNumber: string,
    originalBlastId: string,
  ): Promise<number> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Find campaigns for this blast
    const campaigns = await this.campaignRepository.find({
      where: { originalBlastId },
    });

    if (campaigns.length === 0) return 0;

    const campaignIds = campaigns.map((c) => c.id);

    // Cancel all scheduled/queued messages for this phone number
    const result = await this.messageRepository
      .createQueryBuilder()
      .update(FollowupMessage)
      .set({ status: FollowupMessageStatus.SKIPPED })
      .where('followupCampaignId IN (:...campaignIds)', { campaignIds })
      .andWhere('phoneNumber = :phoneNumber', { phoneNumber: normalizedPhone })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          FollowupMessageStatus.SCHEDULED,
          FollowupMessageStatus.QUEUED,
        ],
      })
      .execute();

    const cancelledCount = result.affected || 0;

    if (cancelledCount > 0) {
      // Update campaign stats
      for (const campaign of campaigns) {
        await this.campaignRepository.increment(
          { id: campaign.id },
          'totalSkipped',
          cancelledCount,
        );
      }

      this.logger.log(
        `Cancelled ${cancelledCount} scheduled follow-ups for ${normalizedPhone}`,
      );
    }

    return cancelledCount;
  }

  /**
   * Get eligible recipients for a campaign based on trigger
   */
  async getEligibleRecipients(
    campaignId: string,
  ): Promise<{ blastMessageId: string; phoneNumber: string }[]> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });

    if (!campaign) return [];

    // Get all sent blast messages for the original blast
    const blastMessages = await this.blastMessageRepository.find({
      where: {
        blastId: campaign.originalBlastId,
        status: MessageStatus.SENT,
      },
    });

    const eligible: { blastMessageId: string; phoneNumber: string }[] = [];

    for (const bm of blastMessages) {
      const normalizedPhone = this.normalizePhoneNumber(bm.phoneNumber);

      // Check if already has followup scheduled for next step
      const existingFollowup = await this.messageRepository.findOne({
        where: {
          followupCampaignId: campaignId,
          phoneNumber: normalizedPhone,
          status: In([
            FollowupMessageStatus.SCHEDULED,
            FollowupMessageStatus.QUEUED,
          ]),
        },
      });

      if (existingFollowup) continue;

      // Check how many followups already sent
      const sentCount = await this.messageRepository.count({
        where: {
          followupCampaignId: campaignId,
          phoneNumber: normalizedPhone,
          status: FollowupMessageStatus.SENT,
        },
      });

      if (sentCount >= campaign.maxFollowups) continue;

      // Check trigger condition
      const shouldSend = await this.shouldFollowup(
        campaign.userId,
        normalizedPhone,
        campaign.originalBlastId,
        campaign.trigger,
      );

      if (shouldSend) {
        eligible.push({
          blastMessageId: bm.id,
          phoneNumber: normalizedPhone,
        });
      }
    }

    return eligible;
  }

  /**
   * Create scheduled followup messages for eligible recipients
   */
  async scheduleFollowupsForCampaign(campaignId: string): Promise<number> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });

    if (!campaign || !campaign.isActive || campaign.status !== FollowupStatus.ACTIVE) {
      return 0;
    }

    const eligible = await this.getEligibleRecipients(campaignId);
    let scheduledCount = 0;

    for (const { blastMessageId, phoneNumber } of eligible) {
      // Determine next step
      const lastSent = await this.messageRepository.findOne({
        where: {
          followupCampaignId: campaignId,
          phoneNumber,
          status: FollowupMessageStatus.SENT,
        },
        order: { step: 'DESC' },
      });

      const nextStep = lastSent ? lastSent.step + 1 : 1;

      if (nextStep > campaign.messages.length) continue;

      const messageStep = campaign.messages.find((m) => m.step === nextStep);
      if (!messageStep) continue;

      // Calculate scheduled time
      let scheduledAt: Date;
      if (nextStep === 1) {
        // First followup: delay from blast sent time
        const blastMessage = await this.blastMessageRepository.findOne({
          where: { id: blastMessageId },
        });
        const baseTime = blastMessage?.sentAt || new Date();
        scheduledAt = new Date(
          baseTime.getTime() + campaign.delayHours * 60 * 60 * 1000,
        );
      } else {
        // Subsequent followups: delay from previous step
        const prevSent = await this.messageRepository.findOne({
          where: {
            followupCampaignId: campaignId,
            phoneNumber,
            step: nextStep - 1,
            status: FollowupMessageStatus.SENT,
          },
        });
        const baseTime = prevSent?.sentAt || new Date();
        scheduledAt = new Date(
          baseTime.getTime() + messageStep.delayHours * 60 * 60 * 1000,
        );
      }

      // Don't schedule in the past
      if (scheduledAt < new Date()) {
        scheduledAt = new Date();
      }

      // Create scheduled message
      const followupMessage = this.messageRepository.create({
        followupCampaignId: campaignId,
        originalBlastMessageId: blastMessageId,
        phoneNumber,
        step: nextStep,
        message: messageStep.message,
        status: FollowupMessageStatus.SCHEDULED,
        scheduledAt,
      });

      await this.messageRepository.save(followupMessage);
      scheduledCount++;
    }

    if (scheduledCount > 0) {
      await this.campaignRepository.increment(
        { id: campaignId },
        'totalScheduled',
        scheduledCount,
      );

      this.logger.log(
        `Scheduled ${scheduledCount} follow-up messages for campaign ${campaignId}`,
      );

      // Emit WebSocket event
      this.whatsappGateway.server
        .to(`user:${campaign.userId}`)
        .emit('followup:scheduled', {
          campaignId,
          count: scheduledCount,
        });
    }

    return scheduledCount;
  }

  /**
   * Increment reply count for a campaign (called when reply detected after followup)
   */
  async incrementReplyCount(campaignId: string): Promise<void> {
    await this.campaignRepository.increment({ id: campaignId }, 'totalReplied', 1);
  }

  /**
   * Get all active campaigns
   */
  async getActiveCampaigns(): Promise<FollowupCampaign[]> {
    return this.campaignRepository.find({
      where: {
        isActive: true,
        status: FollowupStatus.ACTIVE,
      },
    });
  }

  /**
   * Get scheduled messages ready for processing
   */
  async getScheduledMessagesForProcessing(
    limit: number = 100,
  ): Promise<FollowupMessage[]> {
    return this.messageRepository
      .createQueryBuilder('message')
      .innerJoinAndSelect('message.followupCampaign', 'campaign')
      .where('message.status = :status', {
        status: FollowupMessageStatus.SCHEDULED,
      })
      .andWhere('message.scheduledAt <= :now', { now: new Date() })
      .andWhere('campaign.isActive = true')
      .andWhere('campaign.status = :campaignStatus', {
        campaignStatus: FollowupStatus.ACTIVE,
      })
      .orderBy('message.scheduledAt', 'ASC')
      .take(limit)
      .getMany();
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    status: FollowupMessageStatus,
    extras?: { sentAt?: Date; whatsappMessageId?: string; errorMessage?: string },
  ): Promise<void> {
    await this.messageRepository.update(messageId, {
      status,
      ...extras,
    });
  }

  /**
   * Increment campaign sent count
   */
  async incrementSentCount(campaignId: string): Promise<void> {
    await this.campaignRepository.increment({ id: campaignId }, 'totalSent', 1);
  }

  /**
   * Increment campaign failed count
   */
  async incrementFailedCount(campaignId: string): Promise<void> {
    await this.campaignRepository.increment({ id: campaignId }, 'totalFailed', 1);
  }

  /**
   * Mark campaign as completed if all messages processed
   */
  async checkCampaignCompletion(campaignId: string): Promise<void> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });

    if (!campaign) return;

    // Check if there are any pending messages
    const pendingCount = await this.messageRepository.count({
      where: {
        followupCampaignId: campaignId,
        status: In([
          FollowupMessageStatus.SCHEDULED,
          FollowupMessageStatus.QUEUED,
        ]),
      },
    });

    if (pendingCount === 0 && campaign.status === FollowupStatus.ACTIVE) {
      // All messages processed, check if campaign should be completed
      const eligibleCount = (await this.getEligibleRecipients(campaignId)).length;

      if (eligibleCount === 0) {
        campaign.status = FollowupStatus.COMPLETED;
        await this.campaignRepository.save(campaign);

        this.logger.log(`Follow-up campaign completed: ${campaignId}`);

        // Emit WebSocket event
        this.whatsappGateway.server
          .to(`user:${campaign.userId}`)
          .emit('followup:completed', {
            campaignId,
            totalSent: campaign.totalSent,
            totalSkipped: campaign.totalSkipped,
            totalFailed: campaign.totalFailed,
            totalReplied: campaign.totalReplied,
          });
      }
    }
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
