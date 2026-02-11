import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ContactFollowup,
  ContactFollowupStatus,
} from '../../../database/entities/contact-followup.entity';
import {
  ChatMessage,
  ChatMessageDirection,
  ChatMessageStatus,
} from '../../../database/entities/chat-message.entity';
import { ChatConversation } from '../../../database/entities/chat-conversation.entity';
import { CreateContactFollowupDto } from '../dto';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

export interface ContactFollowupJobData {
  followupId: string;
  userId: string;
  phoneNumber: string;
  message: string;
}

@Injectable()
export class ContactFollowupService {
  private readonly logger = new Logger(ContactFollowupService.name);

  constructor(
    @InjectRepository(ContactFollowup)
    private readonly followupRepository: Repository<ContactFollowup>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly chatConversationRepository: Repository<ChatConversation>,
    @InjectQueue('contact-followup')
    private readonly followupQueue: Queue<ContactFollowupJobData>,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly whatsappService: WhatsAppService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Create a contact followup
   */
  async create(
    userId: string,
    dto: CreateContactFollowupDto,
  ): Promise<ContactFollowup> {
    const scheduledAt = new Date(Date.now() + dto.delayHours * 60 * 60 * 1000);
    const normalizedPhone = this.normalizePhoneNumber(dto.phoneNumber);

    const followup = this.followupRepository.create({
      userId,
      phoneNumber: normalizedPhone,
      message: dto.message,
      status: ContactFollowupStatus.SCHEDULED,
      scheduledAt,
    });

    const saved = await this.followupRepository.save(followup);

    this.logger.log(
      `Contact followup created for ${normalizedPhone} in ${dto.delayHours} hours`,
    );

    // Emit WebSocket event
    this.whatsappGateway.server
      .to(`user:${userId}`)
      .emit('contact-followup:created', {
        id: saved.id,
        phoneNumber: saved.phoneNumber,
        scheduledAt: saved.scheduledAt,
      });

    return saved;
  }

  /**
   * Delete a contact followup
   */
  async delete(userId: string, id: string): Promise<void> {
    const followup = await this.followupRepository.findOne({
      where: { id, userId },
    });

    if (!followup) {
      throw new NotFoundException('Contact followup not found');
    }

    await this.followupRepository.remove(followup);

    this.logger.log(`Contact followup deleted: ${id}`);

    // Emit WebSocket event
    this.whatsappGateway.server
      .to(`user:${userId}`)
      .emit('contact-followup:deleted', { id });
  }

  /**
   * Get scheduled followups ready for processing
   */
  async getScheduledForProcessing(limit: number = 100): Promise<ContactFollowup[]> {
    return this.followupRepository.find({
      where: {
        status: ContactFollowupStatus.SCHEDULED,
        scheduledAt: LessThanOrEqual(new Date()),
      },
      order: { scheduledAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Queue a followup for sending
   */
  async queueFollowup(followup: ContactFollowup): Promise<void> {
    await this.followupQueue.add(
      'send-contact-followup',
      {
        followupId: followup.id,
        userId: followup.userId,
        phoneNumber: followup.phoneNumber,
        message: followup.message,
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

    await this.followupRepository.update(followup.id, {
      status: ContactFollowupStatus.QUEUED,
      queuedAt: new Date(),
    });

    this.logger.log(`Contact followup queued: ${followup.id}`);
  }

  /**
   * Send a followup message
   */
  async sendFollowup(followupId: string): Promise<void> {
    const followup = await this.followupRepository.findOne({
      where: { id: followupId },
    });

    if (!followup) {
      this.logger.warn(`Followup ${followupId} not found`);
      return;
    }

    const userId = followup.userId;

    // Check quota
    const quotaCheck = await this.subscriptionsService.checkQuota(userId);
    if (!quotaCheck.canSend) {
      this.logger.warn(`User ${userId} has insufficient quota`);
      await this.followupRepository.update(followupId, {
        status: ContactFollowupStatus.FAILED,
        errorMessage: 'Insufficient quota',
      });
      return;
    }

    // Check WhatsApp session
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      // Check if number is registered
      const isRegistered = await this.whatsappService.isNumberRegistered(
        userId,
        followup.phoneNumber,
      );

      if (!isRegistered) {
        await this.followupRepository.update(followupId, {
          status: ContactFollowupStatus.FAILED,
          errorMessage: 'Number not registered on WhatsApp',
        });
        return;
      }

      // Send message
      const sendResult = await this.whatsappService.sendMessage(
        userId,
        followup.phoneNumber,
        followup.message,
      );

      // Update followup status
      await this.followupRepository.update(followupId, {
        status: ContactFollowupStatus.SENT,
        sentAt: new Date(),
        whatsappMessageId: sendResult.messageId || undefined,
      });

      // Deduct quota
      await this.subscriptionsService.useQuota(userId, 1);

      // Store in chat_messages
      const session = await this.whatsappService.getSessionStatus(userId);
      const sessionPhoneNumber = session?.phoneNumber || undefined;

      try {
        const chatMsg = this.chatMessageRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber: followup.phoneNumber,
          direction: ChatMessageDirection.OUTGOING,
          body: followup.message,
          hasMedia: false,
          whatsappMessageId: sendResult.messageId || undefined,
          messageType: 'conversation',
          status: ChatMessageStatus.SENT,
          timestamp: new Date(),
          isRead: true,
        });
        const savedChatMsg = await this.chatMessageRepository.save(chatMsg);

        // Sync to ChatConversation
        if (sessionPhoneNumber) {
          await this.syncConversation(
            userId,
            sessionPhoneNumber,
            followup.phoneNumber,
            savedChatMsg,
          );
        }
      } catch (chatError: any) {
        if (chatError?.code !== '23505') {
          this.logger.warn(`Failed to store chat message: ${chatError}`);
        }
      }

      this.logger.log(
        `Contact followup sent: ${followupId} to ${followup.phoneNumber}`,
      );

      // Emit WebSocket event
      this.whatsappGateway.server
        .to(`user:${userId}`)
        .emit('contact-followup:sent', {
          id: followup.id,
          phoneNumber: followup.phoneNumber,
          sentAt: new Date(),
        });
    } catch (error) {
      this.logger.error(`Failed to send contact followup: ${error}`);

      if (followup.retryCount < 2) {
        await this.followupRepository.increment(
          { id: followupId },
          'retryCount',
          1,
        );
        throw error;
      } else {
        await this.followupRepository.update(followupId, {
          status: ContactFollowupStatus.FAILED,
          errorMessage: String(error),
        });
      }
    }
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
      this.logger.warn(`Failed to sync conversation: ${error}`);
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
