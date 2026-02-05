import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlastReply } from '../../../database/entities/blast-reply.entity';
import { Blast } from '../../../database/entities/blast.entity';
import { ReplyQueryDto, ReplyStatsDto } from '../dto/reply.dto';

@Injectable()
export class BlastRepliesService {
  constructor(
    @InjectRepository(BlastReply)
    private readonly replyRepository: Repository<BlastReply>,
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
  ) {}

  /**
   * Get all replies for a specific blast with pagination
   */
  async findByBlast(
    userId: string,
    blastId: string,
    query: ReplyQueryDto,
  ): Promise<{
    data: BlastReply[];
    total: number;
    page: number;
    limit: number;
  }> {
    // Verify blast belongs to user
    await this.verifyBlastOwnership(userId, blastId);

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const queryBuilder = this.replyRepository
      .createQueryBuilder('reply')
      .where('reply.blastId = :blastId', { blastId })
      .orderBy('reply.receivedAt', 'DESC');

    if (query.unreadOnly) {
      queryBuilder.andWhere('reply.isRead = :isRead', { isRead: false });
    }

    if (query.phoneNumber) {
      queryBuilder.andWhere('reply.phoneNumber LIKE :phone', {
        phone: `%${query.phoneNumber}%`,
      });
    }

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  /**
   * Get a single reply by ID
   */
  async findOne(
    userId: string,
    blastId: string,
    replyId: string,
  ): Promise<BlastReply> {
    // Verify blast belongs to user
    await this.verifyBlastOwnership(userId, blastId);

    const reply = await this.replyRepository.findOne({
      where: { id: replyId, blastId },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    return reply;
  }

  /**
   * Mark a reply as read
   */
  async markAsRead(
    userId: string,
    blastId: string,
    replyId: string,
  ): Promise<BlastReply> {
    const reply = await this.findOne(userId, blastId, replyId);

    if (!reply.isRead) {
      reply.isRead = true;
      reply.readAt = new Date();
      await this.replyRepository.save(reply);
    }

    return reply;
  }

  /**
   * Mark multiple replies as read
   */
  async markMultipleAsRead(
    userId: string,
    blastId: string,
    replyIds: string[],
  ): Promise<{ updated: number }> {
    // Verify blast belongs to user
    await this.verifyBlastOwnership(userId, blastId);

    const result = await this.replyRepository
      .createQueryBuilder()
      .update(BlastReply)
      .set({ isRead: true, readAt: new Date() })
      .where('blastId = :blastId', { blastId })
      .andWhere('id IN (:...replyIds)', { replyIds })
      .andWhere('isRead = :isRead', { isRead: false })
      .execute();

    return { updated: result.affected || 0 };
  }

  /**
   * Get all unread replies for a user with pagination
   */
  async findUnread(
    userId: string,
    query: ReplyQueryDto,
  ): Promise<{
    data: BlastReply[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const queryBuilder = this.replyRepository
      .createQueryBuilder('reply')
      .innerJoin('reply.blast', 'blast')
      .where('blast.userId = :userId', { userId })
      .andWhere('reply.isRead = :isRead', { isRead: false })
      .orderBy('reply.receivedAt', 'DESC');

    if (query.phoneNumber) {
      queryBuilder.andWhere('reply.phoneNumber LIKE :phone', {
        phone: `%${query.phoneNumber}%`,
      });
    }

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  /**
   * Get reply statistics for a user
   */
  async getStats(userId: string): Promise<ReplyStatsDto> {
    // Get total replies
    const totalReplies = await this.replyRepository
      .createQueryBuilder('reply')
      .innerJoin('reply.blast', 'blast')
      .where('blast.userId = :userId', { userId })
      .getCount();

    // Get unread count
    const unreadCount = await this.replyRepository
      .createQueryBuilder('reply')
      .innerJoin('reply.blast', 'blast')
      .where('blast.userId = :userId', { userId })
      .andWhere('reply.isRead = :isRead', { isRead: false })
      .getCount();

    // Get today's replies
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = await this.replyRepository
      .createQueryBuilder('reply')
      .innerJoin('reply.blast', 'blast')
      .where('blast.userId = :userId', { userId })
      .andWhere('reply.receivedAt >= :today', { today })
      .getCount();

    // Get number of blasts with replies
    const blastsWithReplies = await this.blastRepository
      .createQueryBuilder('blast')
      .where('blast.userId = :userId', { userId })
      .andWhere('blast.replyCount > 0')
      .getCount();

    return {
      totalReplies,
      unreadCount,
      todayCount,
      blastsWithReplies,
    };
  }

  /**
   * Verify that a blast belongs to a user
   */
  private async verifyBlastOwnership(
    userId: string,
    blastId: string,
  ): Promise<Blast> {
    const blast = await this.blastRepository.findOne({
      where: { id: blastId, userId },
    });

    if (!blast) {
      throw new NotFoundException('Blast not found');
    }

    return blast;
  }
}
