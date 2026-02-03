import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Blast, BlastStatus, BlastMessage, MessageStatus } from '../../database/entities/blast.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateBlastDto, BlastQueryDto } from './dto';
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
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    userId: string,
    createBlastDto: CreateBlastDto,
    imageUrl?: string,
  ): Promise<Blast> {
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

    const phoneNumbers = createBlastDto.phoneNumbers || [];
    const recipientCount = phoneNumbers.length;
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

    // Use transaction for atomicity
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create blast
      const blast = this.blastRepository.create({
        userId,
        name: createBlastDto.name,
        message: createBlastDto.message,
        totalRecipients: recipientCount,
        pendingCount: recipientCount,
        delayMs: createBlastDto.delayMs || 3000,
        status: BlastStatus.PENDING,
        imageUrl: imageUrl,
      });

      await queryRunner.manager.save(blast);

      // Create message records in bulk
      const messages = phoneNumbers.map((phoneNumber) =>
        this.messageRepository.create({
          blastId: blast.id,
          phoneNumber: this.formatPhoneNumber(phoneNumber),
          status: MessageStatus.PENDING,
        }),
      );

      await queryRunner.manager.save(messages);
      await queryRunner.commitTransaction();

      this.logger.log(`Blast ${blast.id} created with ${recipientCount} recipients`);
      return blast;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async startBlast(userId: string, blastId: string): Promise<Blast> {
    const blast = await this.findOne(userId, blastId);

    if (blast.status !== BlastStatus.PENDING) {
      throw new BadRequestException(`Blast cannot be started. Current status: ${blast.status}`);
    }

    // Check if user has another blast in progress
    const processingBlast = await this.blastRepository.findOne({
      where: {
        userId,
        status: BlastStatus.PROCESSING,
      },
    });

    if (processingBlast) {
      throw new BadRequestException(
        `You have a blast in progress (${processingBlast.name}). Please wait for it to complete before starting another.`
      );
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

    // Build bulk job data
    const jobs = messages.map((message, i) => ({
      name: 'send-message',
      data: {
        blastId,
        messageId: message.id,
        userId,
        phoneNumber: message.phoneNumber,
        message: blast.message,
        imageUrl: blast.imageUrl || undefined,
      } as BlastJobData,
      opts: {
        delay: i * blast.delayMs,
        attempts: 3,
        backoff: {
          type: 'exponential' as const,
          delay: 5000,
        },
      },
    }));

    // Add all jobs in bulk
    await this.blastQueue.addBulk(jobs);

    // Bulk update all messages to queued status
    const messageIds = messages.map((m) => m.id);
    await this.messageRepository
      .createQueryBuilder()
      .update()
      .set({ status: MessageStatus.QUEUED })
      .whereInIds(messageIds)
      .execute();

    // Send blast-started WebSocket event
    this.whatsappGateway.sendBlastStarted(userId, {
      blastId,
      name: blast.name,
      total: blast.totalRecipients,
    });

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

  async findAll(
    userId: string,
    query: BlastQueryDto,
  ): Promise<{ data: Blast[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.blastRepository.createQueryBuilder('blast');
    qb.where('blast.userId = :userId', { userId });

    // Search by name
    if (query.search) {
      qb.andWhere('blast.name ILIKE :search', { search: `%${query.search}%` });
    }

    // Filter by status
    if (query.status) {
      qb.andWhere('blast.status = :status', { status: query.status });
    }

    qb.orderBy('blast.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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
    // Use SQL aggregation for better performance
    const result = await this.blastRepository
      .createQueryBuilder('blast')
      .select('COUNT(*)', 'totalBlasts')
      .addSelect(`SUM(CASE WHEN blast.status = 'completed' THEN 1 ELSE 0 END)`, 'completedBlasts')
      .addSelect('COALESCE(SUM(blast.sentCount), 0)', 'totalMessagesSent')
      .addSelect('COALESCE(SUM(blast.failedCount), 0)', 'totalMessagesFailed')
      .where('blast.userId = :userId', { userId })
      .getRawOne();

    return {
      totalBlasts: parseInt(result.totalBlasts, 10) || 0,
      completedBlasts: parseInt(result.completedBlasts, 10) || 0,
      totalMessagesSent: parseInt(result.totalMessagesSent, 10) || 0,
      totalMessagesFailed: parseInt(result.totalMessagesFailed, 10) || 0,
    };
  }

  async findAllAdmin(query?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: BlastStatus;
    sortBy?: string;
    order?: 'ASC' | 'DESC';
  }): Promise<{ data: Blast[]; total: number }> {
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC' } = query || {};

    const qb = this.blastRepository.createQueryBuilder('blast');
    qb.leftJoinAndSelect('blast.user', 'user');

    if (status) {
      qb.andWhere('blast.status = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(blast.name ILIKE :search OR user.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy(`blast.${sortBy}`, order);
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters (handles +, -, (), spaces, dots, quotes, etc.)
    let cleaned = phone.replace(/\D/g, '');

    // Handle various prefix formats:
    // 0062... (international with 00) -> 62...
    if (cleaned.startsWith('0062')) {
      cleaned = cleaned.substring(2);
    }
    // 620... (e.g., from "62-0821" or "+62 0821") -> remove extra 0 after 62
    else if (cleaned.startsWith('620')) {
      cleaned = '62' + cleaned.substring(3);
    }
    // 0... (local format) -> 62...
    else if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    // Already starts with 62 (without extra 0) -> keep as is

    return cleaned;
  }
}

