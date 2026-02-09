import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LeadsService } from './leads.service';

@Processor('leads')
export class LeadsProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadsProcessor.name);

  constructor(private readonly leadsService: LeadsService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'recalculate-lead':
        return this.handleRecalculateLead(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleRecalculateLead(
    job: Job<{ userId: string; phoneNumber: string }>,
  ) {
    const { userId, phoneNumber } = job.data;
    try {
      await this.leadsService.calculateScore(userId, phoneNumber, true);
      this.logger.debug(`Recalculated score for ${phoneNumber}`);
    } catch (error) {
      this.logger.error(
        `Failed to recalculate score for ${phoneNumber}: ${error.message}`,
      );
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
