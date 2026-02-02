import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Blast, BlastStatus, BlastMessage, MessageStatus } from '../../../database/entities/blast.entity';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';

export interface BlastJobData {
  blastId: string;
  messageId: string;
  userId: string;
  phoneNumber: string;
  message: string;
  imageUrl?: string;
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
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappGateway: WhatsAppGateway,
  ) {
    super();
  }

  async process(job: Job<BlastJobData>): Promise<void> {
    const { blastId, messageId, userId, phoneNumber, message, imageUrl } = job.data;

    this.logger.log(`Processing message ${messageId} for blast ${blastId}`);

    // Check if blast is still active
    const blast = await this.blastRepository.findOne({ where: { id: blastId } });
    if (!blast || blast.status === BlastStatus.CANCELLED) {
      this.logger.log(`Blast ${blastId} was cancelled, skipping message ${messageId}`);
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
      
      // Send message with or without media
      if (imageUrl) {
        await this.whatsappService.sendMessageWithMedia(userId, phoneNumber, message, imageUrl);
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

      this.logger.log(`Message ${messageId} sent successfully to ${phoneNumber}`);

      // Send progress update
      await this.sendProgressUpdate(blastId, userId);

      // Check if blast is complete
      await this.checkBlastCompletion(blastId);
    } catch (error) {
      this.logger.error(`Failed to send message ${messageId}: ${error}`);

      // Update retry count
      const blastMessage = await this.messageRepository.findOne({ where: { id: messageId } });
      if (blastMessage && blastMessage.retryCount < 3) {
        // Will be retried by BullMQ
        await this.messageRepository.update(messageId, {
          retryCount: blastMessage.retryCount + 1,
          errorMessage: String(error),
        });
        throw error;
      } else {
        // Max retries reached, mark as failed
        await this.messageRepository.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: String(error),
        });

        await this.blastRepository.increment({ id: blastId }, 'failedCount', 1);
        await this.blastRepository.decrement({ id: blastId }, 'pendingCount', 1);

        // Send progress update
        await this.sendProgressUpdate(blastId, userId);

        await this.checkBlastCompletion(blastId);
      }
    }
  }

  private async updateMessageStatus(messageId: string, status: MessageStatus): Promise<void> {
    await this.messageRepository.update(messageId, { status });
  }

  private async sendProgressUpdate(blastId: string, userId: string): Promise<void> {
    const blast = await this.blastRepository.findOne({ where: { id: blastId } });
    if (!blast) return;

    const processed = blast.sentCount + blast.failedCount;

    // Only send update every PROGRESS_BATCH_SIZE messages or when complete
    if (processed % this.PROGRESS_BATCH_SIZE === 0 || blast.pendingCount === 0) {
      const percentage = Math.round((processed / blast.totalRecipients) * 100);

      this.whatsappGateway.sendBlastProgress(userId, {
        blastId,
        sent: blast.sentCount,
        failed: blast.failedCount,
        pending: blast.pendingCount,
        total: blast.totalRecipients,
        percentage,
      });
    }
  }

  private async checkBlastCompletion(blastId: string): Promise<void> {
    const blast = await this.blastRepository.findOne({ where: { id: blastId } });
    if (!blast) return;

    if (blast.pendingCount === 0 && blast.status === BlastStatus.PROCESSING) {
      const newStatus = blast.failedCount === blast.totalRecipients
        ? BlastStatus.FAILED
        : BlastStatus.COMPLETED;

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

      // Send blast completed notification
      this.whatsappGateway.sendBlastCompleted(blast.userId, {
        blastId,
        status: newStatus,
        sent: blast.sentCount,
        failed: blast.failedCount,
        duration,
      });

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
