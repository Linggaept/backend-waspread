import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { PackagesService } from '../packages/packages.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { SubscriptionQueryDto } from './dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  private getDateString(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    // PostgreSQL date type returns as string 'YYYY-MM-DD'
    return String(date).split('T')[0];
  }

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly packagesService: PackagesService,
    private readonly whatsappGateway: WhatsAppGateway,
  ) {}

  async activateSubscription(
    userId: string,
    packageId: string,
    paymentId: string | null,
  ): Promise<Subscription> {
    const pkg = await this.packagesService.findOne(packageId);

    // Calculate dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + pkg.durationDays);

    // Create subscription
    const subscription = this.subscriptionRepository.create({
      userId,
      packageId,
      paymentId: paymentId ?? undefined,
      startDate,
      endDate,
      usedQuota: 0,
      todayUsed: 0,
      status: SubscriptionStatus.ACTIVE,
    });

    await this.subscriptionRepository.save(subscription);
    this.logger.log(`Subscription activated for user ${userId}, package ${pkg.name}`);

    return subscription;
  }

  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const now = new Date();

    const subscription = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
      },
      relations: ['package'],
      order: { endDate: 'DESC' },
    });

    if (!subscription) {
      return null;
    }

    // Check if expired
    if (subscription.endDate < now) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepository.save(subscription);

      // Send subscription expired notification
      this.whatsappGateway.sendSubscriptionExpired(userId, {
        expiredAt: subscription.endDate,
      });

      return null;
    }

    return subscription;
  }

  async checkQuota(userId: string): Promise<{
    hasSubscription: boolean;
    canSend: boolean;
    remainingQuota: number;
    remainingDaily: number;
    message?: string;
  }> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return {
        hasSubscription: false,
        canSend: false,
        remainingQuota: 0,
        remainingDaily: 0,
        message: 'No active subscription',
      };
    }

    const pkg = subscription.package;
    const today = new Date().toISOString().split('T')[0];
    const lastUsed = this.getDateString(subscription.lastUsedDate);

    // Reset daily counter if new day
    if (lastUsed !== today) {
      subscription.todayUsed = 0;
      subscription.lastUsedDate = new Date();
      await this.subscriptionRepository.save(subscription);
    }

    const remainingQuota = pkg.monthlyQuota - subscription.usedQuota;
    const remainingDaily = pkg.dailyLimit - subscription.todayUsed;

    const canSend = remainingQuota > 0 && remainingDaily > 0;

    return {
      hasSubscription: true,
      canSend,
      remainingQuota,
      remainingDaily,
      message: canSend ? undefined : 'Quota exceeded',
    };
  }

  async useQuota(userId: string, count: number = 1): Promise<void> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      throw new BadRequestException('No active subscription');
    }

    const today = new Date().toISOString().split('T')[0];
    const lastUsed = this.getDateString(subscription.lastUsedDate);

    // Reset daily counter if new day
    if (lastUsed !== today) {
      subscription.todayUsed = 0;
      subscription.lastUsedDate = new Date();
    }

    subscription.usedQuota += count;
    subscription.todayUsed += count;
    await this.subscriptionRepository.save(subscription);

    // Check and send quota warning
    const pkg = subscription.package;
    const remainingQuota = pkg.monthlyQuota - subscription.usedQuota;
    const percentageRemaining = (remainingQuota / pkg.monthlyQuota) * 100;

    if (remainingQuota <= 0) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: 0,
        limit: pkg.monthlyQuota,
        warningType: 'depleted',
      });
    } else if (percentageRemaining <= 5) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: remainingQuota,
        limit: pkg.monthlyQuota,
        warningType: 'critical',
      });
    } else if (percentageRemaining <= 10) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: remainingQuota,
        limit: pkg.monthlyQuota,
        warningType: 'low',
      });
    }
  }

  async findByUser(userId: string): Promise<Subscription[]> {
    return this.subscriptionRepository.find({
      where: { userId },
      relations: ['package'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(query?: SubscriptionQueryDto): Promise<{ data: Subscription[]; total: number }> {
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC' } = query || {};

    const qb = this.subscriptionRepository.createQueryBuilder('subscription');
    qb.leftJoinAndSelect('subscription.package', 'package');
    qb.leftJoinAndSelect('subscription.user', 'user');

    if (status) {
      qb.andWhere('subscription.status = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(user.email ILIKE :search OR user.name ILIKE :search OR package.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy(`subscription.${sortBy}`, order as 'ASC' | 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  async expireOldSubscriptions(): Promise<number> {
    const now = new Date();

    // First, get the subscriptions that will be expired to send notifications
    const expiringSubscriptions = await this.subscriptionRepository.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: LessThan(now),
      },
    });

    // Send notifications to each user
    for (const subscription of expiringSubscriptions) {
      this.whatsappGateway.sendSubscriptionExpired(subscription.userId, {
        expiredAt: subscription.endDate,
      });
    }

    // Update status
    const result = await this.subscriptionRepository.update(
      {
        status: SubscriptionStatus.ACTIVE,
        endDate: LessThan(now),
      },
      { status: SubscriptionStatus.EXPIRED },
    );

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} subscriptions`);
    }

    return result.affected || 0;
  }
}
