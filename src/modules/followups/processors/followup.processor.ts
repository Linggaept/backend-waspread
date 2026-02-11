import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FollowupMessage,
  FollowupMessageStatus,
} from '../../../database/entities/followup-message.entity';
import {
  FollowupCampaign,
  FollowupStatus,
} from '../../../database/entities/followup-campaign.entity';
import {
  ChatMessage,
  ChatMessageDirection,
  ChatMessageStatus,
} from '../../../database/entities/chat-message.entity';
import { ChatConversation } from '../../../database/entities/chat-conversation.entity';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { FollowupsService } from '../followups.service';
import { FollowupJobData } from '../services/followup-scheduler.service';

@Processor('followup')
export class FollowupProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowupProcessor.name);

  constructor(
    @InjectRepository(FollowupMessage)
    private readonly messageRepository: Repository<FollowupMessage>,
    @InjectRepository(FollowupCampaign)
    private readonly campaignRepository: Repository<FollowupCampaign>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly chatConversationRepository: Repository<ChatConversation>,
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly followupsService: FollowupsService,
  ) {
    super();
  }

  async process(job: Job<FollowupJobData>): Promise<void> {
    const { followupMessageId, campaignId, userId, phoneNumber, message, step } =
      job.data;

    this.logger.log(
      `Processing followup message ${followupMessageId} (step ${step}) for ${phoneNumber}`,
    );

    // Get the followup message record
    const followupMessage = await this.messageRepository.findOne({
      where: { id: followupMessageId },
      relations: ['followupCampaign'],
    });

    if (!followupMessage) {
      this.logger.warn(`Followup message ${followupMessageId} not found`);
      return;
    }

    // Check if campaign is still active
    const campaign = followupMessage.followupCampaign;
    if (!campaign.isActive || campaign.status !== FollowupStatus.ACTIVE) {
      this.logger.log(
        `Campaign ${campaignId} is not active, skipping message ${followupMessageId}`,
      );
      await this.updateMessageStatus(
        followupMessageId,
        FollowupMessageStatus.CANCELLED,
      );
      return;
    }

    // Final check: has recipient replied since queuing?
    const shouldSend = await this.followupsService.shouldFollowup(
      userId,
      phoneNumber,
      campaign.originalBlastId,
      campaign.trigger,
    );

    if (!shouldSend) {
      this.logger.log(
        `Recipient ${phoneNumber} no longer meets trigger condition, skipping`,
      );
      await this.updateMessageStatus(
        followupMessageId,
        FollowupMessageStatus.SKIPPED,
      );

      // Update campaign stats
      await this.campaignRepository.increment(
        { id: campaignId },
        'totalSkipped',
        1,
      );

      return;
    }

    // Check quota
    const quotaCheck = await this.subscriptionsService.checkQuota(userId);
    if (!quotaCheck.canSend) {
      this.logger.warn(
        `User ${userId} has insufficient quota, skipping followup`,
      );
      await this.updateMessageStatus(
        followupMessageId,
        FollowupMessageStatus.FAILED,
        'Insufficient quota',
      );
      await this.followupsService.incrementFailedCount(campaignId);
      return;
    }

    // Check WhatsApp session
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      // Check if number is registered on WhatsApp
      const isRegistered = await this.whatsappService.isNumberRegistered(
        userId,
        phoneNumber,
      );

      if (!isRegistered) {
        this.logger.log(
          `Number ${phoneNumber} is not registered on WhatsApp, skipping`,
        );
        await this.updateMessageStatus(
          followupMessageId,
          FollowupMessageStatus.FAILED,
          'Number not registered on WhatsApp',
        );
        await this.followupsService.incrementFailedCount(campaignId);
        return;
      }

      // Send the message
      const sendResult = await this.whatsappService.sendMessage(
        userId,
        phoneNumber,
        message,
      );

      // Update message status
      await this.messageRepository.update(followupMessageId, {
        status: FollowupMessageStatus.SENT,
        sentAt: new Date(),
        whatsappMessageId: sendResult.messageId || undefined,
      });

      // Deduct quota
      await this.subscriptionsService.useQuota(userId, 1);

      // Store in chat_messages for inbox
      const session = await this.whatsappService.getSessionStatus(userId);
      const sessionPhoneNumber = session?.phoneNumber || undefined;

      try {
        const chatMsg = this.chatMessageRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber,
          direction: ChatMessageDirection.OUTGOING,
          body: message,
          hasMedia: false,
          whatsappMessageId: sendResult.messageId || undefined,
          messageType: 'conversation',
          status: ChatMessageStatus.SENT,
          timestamp: new Date(),
          isRead: true,
          // Note: We could add a followupId field to link to followup campaign
        });
        const savedChatMsg = await this.chatMessageRepository.save(chatMsg);

        // Sync to ChatConversation
        if (sessionPhoneNumber) {
          await this.syncConversation(
            userId,
            sessionPhoneNumber,
            phoneNumber,
            savedChatMsg,
          );
        }
      } catch (chatError: any) {
        if (chatError?.code !== '23505') {
          this.logger.warn(`Failed to store followup chat message: ${chatError}`);
        }
      }

      // Update campaign stats
      await this.followupsService.incrementSentCount(campaignId);

      // Emit WebSocket event
      this.whatsappGateway.server.to(`user:${userId}`).emit('followup:sent', {
        campaignId,
        phoneNumber,
        step,
        sentAt: new Date(),
      });

      this.logger.log(
        `Followup message ${followupMessageId} sent successfully to ${phoneNumber}`,
      );

      // Check if campaign is complete
      await this.followupsService.checkCampaignCompletion(campaignId);
    } catch (error) {
      this.logger.error(
        `Failed to send followup message ${followupMessageId}: ${error}`,
      );

      // Check retry count
      if (followupMessage.retryCount < 2) {
        // Will be retried by BullMQ
        await this.messageRepository.increment(
          { id: followupMessageId },
          'retryCount',
          1,
        );
        throw error;
      } else {
        // Max retries reached, mark as failed
        await this.updateMessageStatus(
          followupMessageId,
          FollowupMessageStatus.FAILED,
          String(error),
        );
        await this.followupsService.incrementFailedCount(campaignId);
      }
    }
  }

  private async updateMessageStatus(
    messageId: string,
    status: FollowupMessageStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.messageRepository.update(messageId, {
      status,
      errorMessage: errorMessage || undefined,
    });
  }

  private async syncConversation(
    userId: string,
    sessionPhoneNumber: string,
    phoneNumber: string,
    chatMsg: ChatMessage,
  ): Promise<void> {
    try {
      let conversation = await this.chatConversationRepository.findOne({
        where: { userId, sessionPhoneNumber, phoneNumber },
      });

      if (!conversation) {
        conversation = this.chatConversationRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber,
          unreadCount: 0,
        });
      }

      conversation.lastMessageId = chatMsg.id;
      conversation.lastMessageBody = chatMsg.body;
      conversation.lastMessageType = chatMsg.messageType;
      conversation.lastMessageTimestamp = chatMsg.timestamp;
      conversation.lastMessageDirection = chatMsg.direction;
      conversation.hasMedia = chatMsg.hasMedia;

      await this.chatConversationRepository.save(conversation);

      // Emit real-time update
      this.whatsappGateway.sendConversationUpdate(userId, {
        phoneNumber: conversation.phoneNumber,
        pushName: conversation.pushName,
        contactName: conversation.contactName,
        lastMessage: {
          id: chatMsg.id,
          body: chatMsg.body,
          direction: chatMsg.direction,
          hasMedia: chatMsg.hasMedia,
          mediaType: chatMsg.messageType,
          timestamp: chatMsg.timestamp,
        },
        unreadCount: conversation.unreadCount,
        blastId: conversation.blastId,
        blastName: conversation.blastName,
      });
    } catch (error) {
      this.logger.warn(`Failed to sync followup conversation: ${error}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<FollowupJobData>, error: Error) {
    this.logger.error(`Followup job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<FollowupJobData>) {
    this.logger.log(`Followup job ${job.id} completed`);
  }
}
