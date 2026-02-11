import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FollowupsService } from '../followups.service';
import { ContactFollowupService } from './contact-followup.service';
import { FollowupMessageStatus } from '../../../database/entities/followup-message.entity';

export interface FollowupJobData {
  followupMessageId: string;
  campaignId: string;
  userId: string;
  phoneNumber: string;
  message: string;
  step: number;
}

@Injectable()
export class FollowupSchedulerService {
  private readonly logger = new Logger(FollowupSchedulerService.name);
  private isProcessing = false;
  private isScheduling = false;

  constructor(
    private readonly followupsService: FollowupsService,
    private readonly contactFollowupService: ContactFollowupService,
    @InjectQueue('followup')
    private readonly followupQueue: Queue<FollowupJobData>,
  ) {}

  /**
   * Process scheduled follow-ups every 15 minutes
   * Finds messages with scheduledAt <= now and queues them for sending
   */
  @Cron('0 */15 * * * *')
  async processScheduledFollowups(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Followup processing already running, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting scheduled followup processing...');

      // Get messages ready for processing
      const messages =
        await this.followupsService.getScheduledMessagesForProcessing(100);

      if (messages.length === 0) {
        this.logger.debug('No scheduled followups to process');
        return;
      }

      this.logger.log(`Processing ${messages.length} scheduled followups`);

      let queuedCount = 0;
      let skippedCount = 0;

      for (const msg of messages) {
        // Re-check if recipient has replied (skip if yes)
        const shouldSend = await this.followupsService.shouldFollowup(
          msg.followupCampaign.userId,
          msg.phoneNumber,
          msg.followupCampaign.originalBlastId,
          msg.followupCampaign.trigger,
        );

        if (!shouldSend) {
          // Recipient has replied or condition no longer met, skip
          await this.followupsService.updateMessageStatus(
            msg.id,
            FollowupMessageStatus.SKIPPED,
          );
          skippedCount++;
          continue;
        }

        // Queue for sending
        await this.followupQueue.add(
          'send-followup',
          {
            followupMessageId: msg.id,
            campaignId: msg.followupCampaignId,
            userId: msg.followupCampaign.userId,
            phoneNumber: msg.phoneNumber,
            message: msg.message,
            step: msg.step,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );

        await this.followupsService.updateMessageStatus(
          msg.id,
          FollowupMessageStatus.QUEUED,
          { queuedAt: new Date() } as any,
        );

        queuedCount++;
      }

      this.logger.log(
        `Followup processing complete: ${queuedCount} queued, ${skippedCount} skipped`,
      );
    } catch (error) {
      this.logger.error(`Error processing scheduled followups: ${error}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Schedule new follow-ups every hour
   * Creates new FollowupMessage records for eligible recipients
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleNewFollowups(): Promise<void> {
    if (this.isScheduling) {
      this.logger.debug('Followup scheduling already running, skipping');
      return;
    }

    this.isScheduling = true;

    try {
      this.logger.log('Starting new followup scheduling...');

      const activeCampaigns = await this.followupsService.getActiveCampaigns();

      if (activeCampaigns.length === 0) {
        this.logger.debug('No active followup campaigns');
        return;
      }

      this.logger.log(
        `Checking ${activeCampaigns.length} active campaigns for scheduling`,
      );

      let totalScheduled = 0;

      for (const campaign of activeCampaigns) {
        try {
          const count =
            await this.followupsService.scheduleFollowupsForCampaign(
              campaign.id,
            );
          totalScheduled += count;

          // Also check if campaign should be marked complete
          await this.followupsService.checkCampaignCompletion(campaign.id);
        } catch (error) {
          this.logger.error(
            `Error scheduling followups for campaign ${campaign.id}: ${error}`,
          );
        }
      }

      this.logger.log(`Scheduling complete: ${totalScheduled} new messages scheduled`);
    } catch (error) {
      this.logger.error(`Error in followup scheduling: ${error}`);
    } finally {
      this.isScheduling = false;
    }
  }

  /**
   * Process contact followups every 1 minute
   * Checks for scheduled contact followups and queues them for sending
   */
  @Cron('0 * * * * *') // Every minute
  async processContactFollowups(): Promise<void> {
    try {
      const followups =
        await this.contactFollowupService.getScheduledForProcessing(50);

      if (followups.length === 0) {
        return;
      }

      this.logger.log(`Processing ${followups.length} contact followups`);

      for (const followup of followups) {
        try {
          await this.contactFollowupService.queueFollowup(followup);
        } catch (error) {
          this.logger.error(
            `Error queuing contact followup ${followup.id}: ${error}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error processing contact followups: ${error}`);
    }
  }

  /**
   * Manual trigger for testing or immediate scheduling
   */
  async triggerProcessing(): Promise<{ queued: number; skipped: number }> {
    this.logger.log('Manual followup processing triggered');

    const messages =
      await this.followupsService.getScheduledMessagesForProcessing(100);

    let queued = 0;
    let skipped = 0;

    for (const msg of messages) {
      const shouldSend = await this.followupsService.shouldFollowup(
        msg.followupCampaign.userId,
        msg.phoneNumber,
        msg.followupCampaign.originalBlastId,
        msg.followupCampaign.trigger,
      );

      if (!shouldSend) {
        await this.followupsService.updateMessageStatus(
          msg.id,
          FollowupMessageStatus.SKIPPED,
        );
        skipped++;
        continue;
      }

      await this.followupQueue.add(
        'send-followup',
        {
          followupMessageId: msg.id,
          campaignId: msg.followupCampaignId,
          userId: msg.followupCampaign.userId,
          phoneNumber: msg.phoneNumber,
          message: msg.message,
          step: msg.step,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      await this.followupsService.updateMessageStatus(
        msg.id,
        FollowupMessageStatus.QUEUED,
      );

      queued++;
    }

    return { queued, skipped };
  }
}
