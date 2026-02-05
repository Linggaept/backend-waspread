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
import { User } from '../../../database/entities/user.entity';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

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
  private readonly PROGRESS_BATCH_SIZE = 5; // Send progress update every N messages

  constructor(
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(BlastMessage)
    private readonly messageRepository: Repository<BlastMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly notificationsService: NotificationsService,
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

    // Check if blast is still active
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
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

        await this.blastRepository.increment(
          { id: blastId },
          'invalidCount',
          1,
        );
        await this.blastRepository.decrement(
          { id: blastId },
          'pendingCount',
          1,
        );

        // Send progress update
        await this.sendProgressUpdate(blastId, userId);
        await this.checkBlastCompletion(blastId);
        return; // Skip without retry
      }

      // Send message with or without media
      if (mediaUrl) {
        await this.whatsappService.sendMessageWithMedia(
          userId,
          phoneNumber,
          message,
          mediaUrl,
          mediaType,
        );
      } else {
        await this.whatsappService.sendMessage(userId, phoneNumber, message);
      }

      // Update message status
      await this.messageRepository.update(messageId, {
        status: MessageStatus.SENT,
        sentAt: new Date(),
      });

      // Update blast counts
      await this.blastRepository.increment({ id: blastId }, 'sentCount', 1);
      await this.blastRepository.decrement({ id: blastId }, 'pendingCount', 1);

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

        await this.blastRepository.increment({ id: blastId }, 'failedCount', 1);
        await this.blastRepository.decrement(
          { id: blastId },
          'pendingCount',
          1,
        );

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
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
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
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
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

  @OnWorkerEvent('failed')
  onFailed(job: Job<BlastJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<BlastJobData>) {
    this.logger.log(`Job ${job.id} completed`);
  }
}
