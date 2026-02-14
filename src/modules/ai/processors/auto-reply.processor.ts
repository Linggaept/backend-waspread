import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AutoReplyService } from '../services/auto-reply.service';

interface AutoReplyJobData {
  logId: string;
  userId: string;
  phoneNumber: string;
  messageBody: string;
  mediaData?: {
    mimetype: string;
    data: string; // base64
  } | null;
}

@Processor('auto-reply')
export class AutoReplyProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoReplyProcessor.name);

  constructor(private readonly autoReplyService: AutoReplyService) {
    super();
  }

  async process(job: Job<AutoReplyJobData>): Promise<void> {
    switch (job.name) {
      case 'send-auto-reply':
        return this.handleSendAutoReply(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleSendAutoReply(job: Job<AutoReplyJobData>): Promise<void> {
    const { logId, phoneNumber, mediaData } = job.data;

    this.logger.debug(
      `[AUTO-REPLY] Processing job ${job.id} for ${phoneNumber}${mediaData ? ' (with image)' : ''}`,
    );

    try {
      await this.autoReplyService.processAutoReply(logId, mediaData || undefined);
    } catch (error) {
      this.logger.error(
        `[AUTO-REPLY] Job ${job.id} failed for ${phoneNumber}: ${error.message}`,
      );
      throw error; // Let BullMQ handle retry
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`[AUTO-REPLY] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[AUTO-REPLY] Job ${job.id} failed after all retries: ${error.message}`,
    );
  }
}
