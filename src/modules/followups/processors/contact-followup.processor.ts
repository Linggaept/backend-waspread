import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ContactFollowupService, ContactFollowupJobData } from '../services/contact-followup.service';

@Processor('contact-followup')
export class ContactFollowupProcessor extends WorkerHost {
  private readonly logger = new Logger(ContactFollowupProcessor.name);

  constructor(private readonly contactFollowupService: ContactFollowupService) {
    super();
  }

  async process(job: Job<ContactFollowupJobData>): Promise<void> {
    const { followupId, phoneNumber } = job.data;

    this.logger.log(`Processing contact followup ${followupId} for ${phoneNumber}`);

    await this.contactFollowupService.sendFollowup(followupId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContactFollowupJobData>, error: Error) {
    this.logger.error(`Contact followup job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ContactFollowupJobData>) {
    this.logger.log(`Contact followup job ${job.id} completed`);
  }
}
