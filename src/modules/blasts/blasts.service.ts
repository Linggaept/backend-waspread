import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Blast, BlastStatus, BlastMessage, MessageStatus } from '../../database/entities/blast.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateBlastDto } from './dto';
import { BlastJobData } from './processors/blast.processor';

@Injectable()
export class BlastsService {
  private readonly logger = new Logger(BlastsService.name);

  constructor(
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(BlastMessage)
    private readonly messageRepository: Repository<BlastMessage>,
    @InjectQueue('blast')
    private readonly blastQueue: Queue<BlastJobData>,
    private readonly whatsappService: WhatsAppService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async create(userId: string, createBlastDto: CreateBlastDto): Promise<Blast> {
    // Check WhatsApp session
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException('WhatsApp session is not connected. Please connect first.');
    }

    // Check subscription quota
    const quotaCheck = await this.subscriptionsService.checkQuota(userId);
    if (!quotaCheck.hasSubscription) {
      throw new ForbiddenException('No active subscription. Please subscribe first.');
    }

    const recipientCount = createBlastDto.phoneNumbers.length;
    if (quotaCheck.remainingQuota < recipientCount) {
      throw new ForbiddenException(
        `Insufficient quota. Required: ${recipientCount}, Available: ${quotaCheck.remainingQuota}`,
      );
    }

    if (quotaCheck.remainingDaily < recipientCount) {
      throw new ForbiddenException(
        `Daily limit exceeded. Required: ${recipientCount}, Remaining today: ${quotaCheck.remainingDaily}`,
      );
    }

    // Create blast
    const blast = this.blastRepository.create({
      userId,
      name: createBlastDto.name,
      message: createBlastDto.message,
      totalRecipients: recipientCount,
      pendingCount: recipientCount,
      delayMs: createBlastDto.delayMs || 3000,
      status: BlastStatus.PENDING,
    });

    await this.blastRepository.save(blast);

    // Create message records
    const messages: BlastMessage[] = [];
    for (const phoneNumber of createBlastDto.phoneNumbers) {
      const message = this.messageRepository.create({
        blastId: blast.id,
        phoneNumber: this.formatPhoneNumber(phoneNumber),
        status: MessageStatus.PENDING,
      });
      messages.push(message);
    }

    await this.messageRepository.save(messages);

    this.logger.log(`Blast ${blast.id} created with ${recipientCount} recipients`);

    return blast;
  }

  async startBlast(userId: string, blastId: string): Promise<Blast> {
    const blast = await this.findOne(userId, blastId);

    if (blast.status !== BlastStatus.PENDING) {
      throw new BadRequestException(`Blast cannot be started. Current status: ${blast.status}`);
    }

    // Check WhatsApp session again
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException('WhatsApp session is not connected');
    }

    // Use quota
    await this.subscriptionsService.useQuota(userId, blast.totalRecipients);

    // Update blast status
    await this.blastRepository.update(blastId, {
      status: BlastStatus.PROCESSING,
      startedAt: new Date(),
    });

    // Get all messages
    const messages = await this.messageRepository.find({
      where: { blastId },
    });

    // Add jobs to queue with delay
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const delay = i * blast.delayMs;

      await this.blastQueue.add(
        'send-message',
        {
          blastId,
          messageId: message.id,
          userId,
          phoneNumber: message.phoneNumber,
          message: blast.message,
        },
        {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      // Update message status to queued
      await this.messageRepository.update(message.id, {
        status: MessageStatus.QUEUED,
      });
    }

    this.logger.log(`Blast ${blastId} started with ${messages.length} messages queued`);

    return this.findOne(userId, blastId);
  }

  async cancelBlast(userId: string, blastId: string): Promise<Blast> {
    const blast = await this.findOne(userId, blastId);

    if (blast.status !== BlastStatus.PENDING && blast.status !== BlastStatus.PROCESSING) {
      throw new BadRequestException(`Blast cannot be cancelled. Current status: ${blast.status}`);
    }

    // Cancel pending/queued messages
    await this.messageRepository.update(
      { blastId, status: MessageStatus.PENDING },
      { status: MessageStatus.CANCELLED },
    );
    await this.messageRepository.update(
      { blastId, status: MessageStatus.QUEUED },
      { status: MessageStatus.CANCELLED },
    );

    // Update blast status
    await this.blastRepository.update(blastId, {
      status: BlastStatus.CANCELLED,
      cancelledAt: new Date(),
    });

    // Drain queue for this blast (remove pending jobs)
    const jobs = await this.blastQueue.getJobs(['delayed', 'waiting']);
    for (const job of jobs) {
      if (job.data.blastId === blastId) {
        await job.remove();
      }
    }

    this.logger.log(`Blast ${blastId} cancelled`);

    return this.findOne(userId, blastId);
  }

  async findAll(userId: string): Promise<Blast[]> {
    return this.blastRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, blastId: string): Promise<Blast> {
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
    });

    if (!blast) {
      throw new NotFoundException(`Blast with ID ${blastId} not found`);
    }

    if (blast.userId !== userId) {
      throw new ForbiddenException('You do not have access to this blast');
    }

    return blast;
  }

  async findOneWithMessages(userId: string, blastId: string): Promise<Blast> {
    const blast = await this.blastRepository.findOne({
      where: { id: blastId },
      relations: ['messages'],
    });

    if (!blast) {
      throw new NotFoundException(`Blast with ID ${blastId} not found`);
    }

    if (blast.userId !== userId) {
      throw new ForbiddenException('You do not have access to this blast');
    }

    return blast;
  }

  async getStats(userId: string): Promise<{
    totalBlasts: number;
    completedBlasts: number;
    totalMessagesSent: number;
    totalMessagesFailed: number;
  }> {
    const blasts = await this.blastRepository.find({ where: { userId } });

    return {
      totalBlasts: blasts.length,
      completedBlasts: blasts.filter((b) => b.status === BlastStatus.COMPLETED).length,
      totalMessagesSent: blasts.reduce((sum, b) => sum + b.sentCount, 0),
      totalMessagesFailed: blasts.reduce((sum, b) => sum + b.failedCount, 0),
    };
  }

  async findAllAdmin(): Promise<Blast[]> {
    return this.blastRepository.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    return cleaned;
  }
}
