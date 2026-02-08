import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Blast,
  BlastStatus,
  BlastMessage,
  MessageStatus,
  MessageErrorType,
} from '../../../database/entities/blast.entity';
import {
  ChatMessage,
  ChatMessageDirection,
  ChatMessageStatus,
} from '../../../database/entities/chat-message.entity';
import { ChatConversation } from '../../../database/entities/chat-conversation.entity';
import { User } from '../../../database/entities/user.entity';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import { FunnelTrackerService } from '../../analytics/services/funnel-tracker.service';

export interface BlastJobData {
  blastId: string;
  messageId: string;
  userId: string;
  phoneNumber: string;
  message: string;
  mediaUrl?: string;
  mediaType?: string; // 'image' | 'video' | 'audio' | 'document'
}

@Processor('blast')
export class BlastProcessor extends WorkerHost {
  private readonly logger = new Logger(BlastProcessor.name);
  private readonly PROGRESS_BATCH_SIZE = 10; // Send progress update every N messages

  constructor(
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(BlastMessage)
    private readonly messageRepository: Repository<BlastMessage>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly chatConversationRepository: Repository<ChatConversation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly notificationsService: NotificationsService,
    private readonly funnelTrackerService: FunnelTrackerService,
  ) {
    super();
  }

  async process(job: Job<BlastJobData>): Promise<void> {
    const {
      blastId,
      messageId,
      userId,
      phoneNumber,
      message,
      mediaUrl,
      mediaType,
    } = job.data;

    this.logger.log(`Processing message ${messageId} for blast ${blastId}`);

    // Check if blast is still active (only fetch status)
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
      select: ['id', 'status'],
    });
    if (!blast || blast.status === BlastStatus.CANCELLED) {
      this.logger.log(
        `Blast ${blastId} was cancelled, skipping message ${messageId}`,
      );
      await this.updateMessageStatus(messageId, MessageStatus.CANCELLED);
      return;
    }

    // Check WhatsApp session
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      // Mark session as actively blasting (protects from auto-disconnect)
      this.whatsappService.setBlastingStatus(userId, true);

      // Check if number is registered on WhatsApp FIRST
      const isRegistered = await this.whatsappService.isNumberRegistered(
        userId,
        phoneNumber,
      );

      if (!isRegistered) {
        this.logger.log(
          `Number ${phoneNumber} is not registered on WhatsApp, skipping`,
        );

        await this.messageRepository.update(messageId, {
          status: MessageStatus.INVALID_NUMBER,
          errorType: MessageErrorType.INVALID_NUMBER,
          errorMessage: 'Number not registered on WhatsApp',
        });

        // Atomic counter update (single query instead of two)
        await this.blastRepository
          .createQueryBuilder()
          .update(Blast)
          .set({
            invalidCount: () => '"invalidCount" + 1',
            pendingCount: () => '"pendingCount" - 1',
          })
          .where('id = :id', { id: blastId })
          .execute();

        // Send progress update
        await this.sendProgressUpdate(blastId, userId);
        await this.checkBlastCompletion(blastId);
        return; // Skip without retry
      }

      // Send message with or without media
      let sendResult: { success: boolean; messageId?: string };
      if (mediaUrl) {
        try {
          sendResult = await this.whatsappService.sendMessageWithMedia(
            userId,
            phoneNumber,
            message,
            mediaUrl,
            mediaType,
          );
        } catch (mediaError) {
          // Check if error is timeout or network related
          const errorMsg = String(mediaError).toLowerCase();
          if (
            errorMsg.includes('timeout') ||
            errorMsg.includes('network') ||
            errorMsg.includes('enotfound') ||
            errorMsg.includes('axios')
          ) {
            this.logger.warn(
              `Media send failed due to network, falling back to text only: ${mediaError}`,
            );
            // Fallback to text only
            sendResult = await this.whatsappService.sendMessage(
              userId,
              phoneNumber,
              message
                ? `${message}\n\n*[System: Gambar gagal dimuat karena gangguan koneksi server]*`
                : '*[System: Gambar gagal dimuat karena gangguan koneksi server]*',
            );
          } else {
            // Re-throw other errors
            throw mediaError;
          }
        }
      } else {
        sendResult = await this.whatsappService.sendMessage(
          userId,
          phoneNumber,
          message,
        );
      }

      // Update message status + save whatsappMessageId for campaign linking
      await this.messageRepository.update(messageId, {
        status: MessageStatus.SENT,
        sentAt: new Date(),
        whatsappMessageId: sendResult.messageId || undefined,
      });

      // Store in chat_messages for inbox conversations
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      const session = await this.whatsappService.getSessionStatus(userId);
      const sessionPhoneNumber = session?.phoneNumber || undefined;
      try {
        const chatMsg = this.chatMessageRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber: normalizedPhone,
          direction: ChatMessageDirection.OUTGOING,
          body: message,
          hasMedia: !!mediaUrl,
          mediaType: mediaType || undefined,
          mediaUrl: mediaUrl || undefined,
          whatsappMessageId: sendResult.messageId || undefined,
          messageType: mediaType ? `${mediaType}Message` : 'conversation',
          status: ChatMessageStatus.SENT,
          timestamp: new Date(),
          isRead: true,
          blastId,
        });
        const savedChatMsg = await this.chatMessageRepository.save(chatMsg);

        // Sync to ChatConversation for conversation list
        if (sessionPhoneNumber) {
          await this.syncBlastConversation(
            userId,
            sessionPhoneNumber,
            normalizedPhone,
            savedChatMsg,
            blastId,
          );
        }
      } catch (chatError: any) {
        // Ignore duplicate (dedup by whatsappMessageId)
        if (chatError?.code !== '23505') {
          this.logger.warn(`Failed to store blast chat message: ${chatError}`);
        }
      }

      // Atomic counter update (single query instead of two)
      await this.blastRepository
        .createQueryBuilder()
        .update(Blast)
        .set({
          sentCount: () => '"sentCount" + 1',
          pendingCount: () => '"pendingCount" - 1',
        })
        .where('id = :id', { id: blastId })
        .execute();

      // Create/update funnel entry for this recipient (fire and forget)
      const blastInfo = await this.blastRepository.findOne({
        where: { id: blastId },
        select: ['id', 'name'],
      });
      this.funnelTrackerService
        .onBlastSent(
          userId,
          normalizedPhone,
          blastId,
          blastInfo?.name || 'Blast',
        )
        .catch((err) => {
          this.logger.warn(`Failed to create funnel entry: ${err}`);
        });

      this.logger.log(
        `Message ${messageId} sent successfully to ${phoneNumber}`,
      );

      // Send progress update
      await this.sendProgressUpdate(blastId, userId);

      // Check if blast is complete
      await this.checkBlastCompletion(blastId);
    } catch (error) {
      this.logger.error(`Failed to send message ${messageId}: ${error}`);

      // Categorize the error
      const errorType = this.categorizeError(error);

      // Update retry count
      const blastMessage = await this.messageRepository.findOne({
        where: { id: messageId },
      });
      if (blastMessage && blastMessage.retryCount < 3) {
        // Will be retried by BullMQ
        await this.messageRepository.update(messageId, {
          retryCount: blastMessage.retryCount + 1,
          errorMessage: String(error),
          errorType,
        });
        throw error;
      } else {
        // Max retries reached, mark as failed
        await this.messageRepository.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: String(error),
          errorType,
        });

        // Atomic counter update (single query instead of two)
        await this.blastRepository
          .createQueryBuilder()
          .update(Blast)
          .set({
            failedCount: () => '"failedCount" + 1',
            pendingCount: () => '"pendingCount" - 1',
          })
          .where('id = :id', { id: blastId })
          .execute();

        // Send progress update
        await this.sendProgressUpdate(blastId, userId);

        await this.checkBlastCompletion(blastId);
      }
    }
  }

  private categorizeError(error: any): MessageErrorType {
    const msg = (error?.message || String(error)).toLowerCase();

    if (msg.includes('not registered') || msg.includes('invalid number')) {
      return MessageErrorType.INVALID_NUMBER;
    }
    if (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('econnrefused')
    ) {
      return MessageErrorType.NETWORK_ERROR;
    }
    if (
      msg.includes('session') ||
      msg.includes('disconnected') ||
      msg.includes('detached') ||
      msg.includes('expired')
    ) {
      return MessageErrorType.SESSION_ERROR;
    }
    if (
      msg.includes('rate') ||
      msg.includes('limit') ||
      msg.includes('too many') ||
      msg.includes('spam')
    ) {
      return MessageErrorType.RATE_LIMITED;
    }
    return MessageErrorType.UNKNOWN;
  }

  private async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
  ): Promise<void> {
    await this.messageRepository.update(messageId, { status });
  }

  private async sendProgressUpdate(
    blastId: string,
    userId: string,
  ): Promise<void> {
    // Only fetch fields needed for progress calculation
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
      select: [
        'id',
        'sentCount',
        'failedCount',
        'invalidCount',
        'pendingCount',
        'totalRecipients',
      ],
    });
    if (!blast) return;

    const processed = blast.sentCount + blast.failedCount + blast.invalidCount;

    // Only send update every PROGRESS_BATCH_SIZE messages or when complete
    if (
      processed % this.PROGRESS_BATCH_SIZE === 0 ||
      blast.pendingCount === 0
    ) {
      const percentage = Math.round((processed / blast.totalRecipients) * 100);

      this.whatsappGateway.sendBlastProgress(userId, {
        blastId,
        sent: blast.sentCount,
        failed: blast.failedCount,
        invalid: blast.invalidCount,
        pending: blast.pendingCount,
        total: blast.totalRecipients,
        percentage,
      });
    }
  }

  private async checkBlastCompletion(blastId: string): Promise<void> {
    // Only fetch fields needed for completion check
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
      select: [
        'id',
        'userId',
        'name',
        'status',
        'pendingCount',
        'sentCount',
        'failedCount',
        'invalidCount',
        'totalRecipients',
        'startedAt',
      ],
    });
    if (!blast) return;

    if (blast.pendingCount === 0 && blast.status === BlastStatus.PROCESSING) {
      // Consider failed if all messages failed or were invalid
      const allFailed =
        blast.failedCount + blast.invalidCount === blast.totalRecipients;
      const newStatus = allFailed ? BlastStatus.FAILED : BlastStatus.COMPLETED;

      const completedAt = new Date();
      await this.blastRepository.update(blastId, {
        status: newStatus,
        completedAt,
      });

      // Mark session as no longer blasting (allows auto-disconnect)
      this.whatsappService.setBlastingStatus(blast.userId, false);

      // Calculate duration in seconds
      const duration = blast.startedAt
        ? Math.round((completedAt.getTime() - blast.startedAt.getTime()) / 1000)
        : 0;

      // Send blast completed notification via WebSocket
      this.whatsappGateway.sendBlastCompleted(blast.userId, {
        blastId,
        status: newStatus,
        sent: blast.sentCount,
        failed: blast.failedCount,
        invalid: blast.invalidCount,
        duration,
      });

      // Send in-app + email notification
      const user = await this.userRepository.findOne({
        where: { id: blast.userId },
      });
      if (user) {
        if (newStatus === BlastStatus.COMPLETED) {
          this.notificationsService
            .notifyBlastCompleted(
              blast.userId,
              user.email,
              blast.name,
              blast.sentCount,
              blast.failedCount,
              blast.invalidCount,
            )
            .catch((err) =>
              this.logger.error(
                'Failed to send blast completed notification:',
                err,
              ),
            );
        } else {
          this.notificationsService
            .notifyBlastFailed(
              blast.userId,
              user.email,
              blast.name,
              'Semua pesan gagal terkirim',
            )
            .catch((err) =>
              this.logger.error(
                'Failed to send blast failed notification:',
                err,
              ),
            );
        }
      }

      this.logger.log(`Blast ${blastId} completed with status: ${newStatus}`);
    }
  }

  /**
   * Sync blast message to ChatConversation for conversation list
   */
  private async syncBlastConversation(
    userId: string,
    sessionPhoneNumber: string,
    phoneNumber: string,
    chatMsg: ChatMessage,
    blastId: string,
  ): Promise<void> {
    try {
      // Get blast name for display
      const blast = await this.blastRepository.findOne({
        where: { id: blastId },
        select: ['id', 'name'],
      });

      // Find or create conversation
      let conversation = await this.chatConversationRepository.findOne({
        where: { userId, sessionPhoneNumber, phoneNumber },
      });

      if (!conversation) {
        conversation = this.chatConversationRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber,
          pushName: undefined,
          contactName: undefined,
          unreadCount: 0,
        });
      }

      // Update last message info
      conversation.lastMessageId = chatMsg.id;
      conversation.lastMessageBody = chatMsg.body;
      conversation.lastMessageType = chatMsg.messageType;
      conversation.lastMessageTimestamp = chatMsg.timestamp;
      conversation.lastMessageDirection = chatMsg.direction;
      conversation.hasMedia = chatMsg.hasMedia;
      conversation.blastId = blastId;
      conversation.blastName = blast?.name || 'Blast';

      await this.chatConversationRepository.save(conversation);

      // Emit real-time update for conversation list sorting
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
      this.logger.warn(`Failed to sync blast conversation: ${error}`);
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

  @OnWorkerEvent('failed')
  onFailed(job: Job<BlastJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<BlastJobData>) {
    this.logger.log(`Job ${job.id} completed`);
  }
}
