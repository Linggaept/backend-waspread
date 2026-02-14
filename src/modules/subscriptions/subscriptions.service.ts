import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { Package } from '../../database/entities/package.entity';
import { PackagesService } from '../packages/packages.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { NotificationsService } from '../notifications/notifications.service';
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly packagesService: PackagesService,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async activateSubscription(
    userId: string,
    packageId: string,
    paymentId: string | null,
  ): Promise<Subscription> {
    // FIX: Check if subscription already exists for this paymentId (prevent duplicate from webhook retry)
    if (paymentId) {
      const existingSubscription = await this.subscriptionRepository.findOne({
        where: { paymentId },
      });
      if (existingSubscription) {
        this.logger.warn(
          `Subscription already exists for paymentId ${paymentId}, returning existing`,
        );
        return existingSubscription;
      }
    }

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
      usedBlastQuota: 0,
      todayBlastUsed: 0,
      status: SubscriptionStatus.ACTIVE,
    });

    try {
      await this.subscriptionRepository.save(subscription);
    } catch (error: any) {
      // FIX: Handle unique constraint violation (race condition fallback)
      if (error.code === '23505' && paymentId) {
        // PostgreSQL unique_violation
        this.logger.warn(
          `Duplicate subscription attempt for paymentId ${paymentId}, fetching existing`,
        );
        const existing = await this.subscriptionRepository.findOne({
          where: { paymentId },
        });
        if (existing) return existing;
      }
      throw error;
    }

    this.logger.log(
      `Subscription activated for user ${userId}, package ${pkg.name}`,
    );

    // Send notification
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user) {
      this.notificationsService
        .notifySubscriptionActivated(
          userId,
          user.email,
          pkg.name,
          pkg.blastMonthlyQuota,
          endDate.toLocaleDateString('id-ID'),
        )
        .catch((err) =>
          this.logger.error(
            'Failed to send subscription activated notification:',
            err,
          ),
        );
    }

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

      // Send subscription expired notification via WebSocket
      this.whatsappGateway.sendSubscriptionExpired(userId, {
        expiredAt: subscription.endDate,
      });

      // Send notification via NotificationsService
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user) {
        this.notificationsService
          .notifySubscriptionExpired(userId, user.email)
          .catch((err) =>
            this.logger.error(
              'Failed to send subscription expired notification:',
              err,
            ),
          );
      }

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
    const lastUsed = this.getDateString(subscription.lastBlastDate);

    // Reset daily counter if new day
    if (lastUsed !== today) {
      subscription.todayBlastUsed = 0;
      subscription.lastBlastDate = new Date();
      await this.subscriptionRepository.save(subscription);
    }

    // 0 = unlimited
    const isMonthlyUnlimited = pkg.blastMonthlyQuota === 0;
    const isDailyUnlimited = pkg.blastDailyLimit === 0;

    const remainingQuota = isMonthlyUnlimited
      ? -1 // -1 indicates unlimited
      : pkg.blastMonthlyQuota - subscription.usedBlastQuota;
    const remainingDaily = isDailyUnlimited
      ? -1 // -1 indicates unlimited
      : pkg.blastDailyLimit - subscription.todayBlastUsed;

    const canSendMonthly = isMonthlyUnlimited || remainingQuota > 0;
    const canSendDaily = isDailyUnlimited || remainingDaily > 0;
    const canSend = canSendMonthly && canSendDaily;

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
    const lastUsed = this.getDateString(subscription.lastBlastDate);

    // Reset daily counter if new day
    if (lastUsed !== today) {
      subscription.todayBlastUsed = 0;
      subscription.lastBlastDate = new Date();
    }

    subscription.usedBlastQuota += count;
    subscription.todayBlastUsed += count;
    await this.subscriptionRepository.save(subscription);

    const pkg = subscription.package;

    // Calculate remaining (handle unlimited)
    const isMonthlyUnlimited = pkg.blastMonthlyQuota === 0;
    const isDailyUnlimited = pkg.blastDailyLimit === 0;

    const monthlyRemaining = isMonthlyUnlimited
      ? -1
      : pkg.blastMonthlyQuota - subscription.usedBlastQuota;
    const dailyRemaining = isDailyUnlimited
      ? -1
      : pkg.blastDailyLimit - subscription.todayBlastUsed;

    // Send realtime quota update
    this.whatsappGateway.sendQuotaUpdate(userId, {
      blastQuota: {
        monthlyUsed: subscription.usedBlastQuota,
        monthlyRemaining,
        dailyUsed: subscription.todayBlastUsed,
        dailyRemaining,
        isUnlimited: isMonthlyUnlimited && isDailyUnlimited,
      },
    });

    // Skip warnings if unlimited
    if (isMonthlyUnlimited) {
      return;
    }

    const remainingQuota = pkg.blastMonthlyQuota - subscription.usedBlastQuota;
    const percentageRemaining = (remainingQuota / pkg.blastMonthlyQuota) * 100;

    if (remainingQuota <= 0) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: 0,
        limit: pkg.blastMonthlyQuota,
        warningType: 'depleted',
      });
      // Send in-app + email notification for depleted quota
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user) {
        this.notificationsService
          .notifyQuotaDepleted(userId, user.email)
          .catch((err) =>
            this.logger.error(
              'Failed to send quota depleted notification:',
              err,
            ),
          );
      }
    } else if (percentageRemaining <= 5) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: remainingQuota,
        limit: pkg.blastMonthlyQuota,
        warningType: 'critical',
      });
    } else if (percentageRemaining <= 20) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: remainingQuota,
        limit: pkg.blastMonthlyQuota,
        warningType: 'low',
      });
      // Send in-app notification for low quota (20%)
      this.notificationsService
        .notifyQuotaLow(userId, remainingQuota, pkg.blastMonthlyQuota)
        .catch((err) =>
          this.logger.error('Failed to send quota low notification:', err),
        );
    }
  }

  async findByUser(userId: string): Promise<Subscription[]> {
    return this.subscriptionRepository.find({
      where: { userId },
      relations: ['package'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(
    query?: SubscriptionQueryDto,
  ): Promise<{ data: Subscription[]; total: number }> {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      sortBy = 'createdAt',
      order = 'DESC',
    } = query || {};

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

  // ==================== Feature Access ====================

  async checkFeatureAccess(
    userId: string,
    feature: 'analytics' | 'ai' | 'leadScoring' | 'followup',
  ): Promise<{ hasAccess: boolean; message?: string }> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return { hasAccess: false, message: 'No active subscription' };
    }

    const pkg = subscription.package;
    let hasAccess = false;

    switch (feature) {
      case 'analytics':
        hasAccess = pkg.hasAnalytics;
        break;
      case 'ai':
        hasAccess = pkg.hasAiFeatures;
        break;
      case 'leadScoring':
        hasAccess = pkg.hasLeadScoring;
        break;
      case 'followup':
        hasAccess = pkg.hasFollowupFeature;
        break;
    }

    if (!hasAccess) {
      return {
        hasAccess: false,
        message: `Feature '${feature}' is not available in your current package`,
      };
    }

    return { hasAccess: true };
  }

  // ==================== Auto-Reply Feature ====================

  async checkAutoReplyFeatureAccess(
    userId: string,
  ): Promise<{ hasAccess: boolean; message?: string }> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return { hasAccess: false, message: 'No active subscription' };
    }

    const pkg = subscription.package;

    if (!pkg.hasAutoReplyFeature) {
      return {
        hasAccess: false,
        message: 'Auto-reply feature is not available in your current package',
      };
    }

    return { hasAccess: true };
  }

  // NOTE: Auto-reply quota methods removed - now using unified AI token system
  // See AiTokenService for token balance management

  // ==================== AI Quota ====================

  async checkAiQuota(userId: string): Promise<{
    hasAccess: boolean;
    remaining: number;
    limit: number;
    message?: string;
  }> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return {
        hasAccess: false,
        remaining: 0,
        limit: 0,
        message: 'No active subscription',
      };
    }

    const pkg = subscription.package;

    // Check if AI features are enabled
    if (!pkg.hasAiFeatures) {
      return {
        hasAccess: false,
        remaining: 0,
        limit: 0,
        message: 'AI features are not available in your current package',
      };
    }

    // 0 = unlimited
    if (pkg.aiQuota === 0) {
      return {
        hasAccess: true,
        remaining: -1, // -1 indicates unlimited
        limit: 0,
      };
    }

    const remaining = pkg.aiQuota - subscription.usedAiQuota;
    const hasAccess = remaining > 0;

    return {
      hasAccess,
      remaining,
      limit: pkg.aiQuota,
      message: hasAccess ? undefined : 'AI quota exceeded',
    };
  }

  async useAiQuota(userId: string, count: number = 1): Promise<void> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      throw new BadRequestException('No active subscription');
    }

    const pkg = subscription.package;

    // Check if AI features are enabled
    if (!pkg.hasAiFeatures) {
      throw new ForbiddenException(
        'AI features are not available in your current package',
      );
    }

    // 0 = unlimited, no need to track but still send update
    if (pkg.aiQuota === 0) {
      // Send realtime update for unlimited
      this.whatsappGateway.sendAiQuotaUpdate(userId, {
        aiQuota: {
          limit: 0,
          used: subscription.usedAiQuota,
          remaining: -1,
          isUnlimited: true,
        },
      });
      return;
    }

    subscription.usedAiQuota += count;
    await this.subscriptionRepository.save(subscription);

    const remaining = pkg.aiQuota - subscription.usedAiQuota;

    // Send realtime AI quota update
    this.whatsappGateway.sendAiQuotaUpdate(userId, {
      aiQuota: {
        limit: pkg.aiQuota,
        used: subscription.usedAiQuota,
        remaining,
        isUnlimited: false,
      },
    });

    // Check and send warning if quota is low
    const percentageRemaining = (remaining / pkg.aiQuota) * 100;

    if (remaining <= 0) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining: 0,
        limit: pkg.aiQuota,
        warningType: 'depleted',
      });
    } else if (percentageRemaining <= 20) {
      this.whatsappGateway.sendQuotaWarning(userId, {
        remaining,
        limit: pkg.aiQuota,
        warningType: 'low',
      });
    }
  }

  // ==================== Blast Limit ====================

  async checkBlastLimit(userId: string): Promise<{
    canCreate: boolean;
    todayUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
    message?: string;
  }> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return {
        canCreate: false,
        todayUsed: 0,
        dailyLimit: 0,
        monthlyUsed: 0,
        monthlyLimit: 0,
        message: 'No active subscription',
      };
    }

    const pkg = subscription.package;
    const today = new Date().toISOString().split('T')[0];
    const lastBlast = this.getDateString(subscription.lastBlastDate);

    // Reset daily counter if new day
    if (lastBlast !== today) {
      subscription.todayBlastUsed = 0;
      await this.subscriptionRepository.save(subscription);
    }

    const dailyLimitOk =
      pkg.blastDailyLimit === 0 ||
      subscription.todayBlastUsed < pkg.blastDailyLimit;
    const monthlyLimitOk =
      pkg.blastMonthlyQuota === 0 ||
      subscription.usedBlastQuota < pkg.blastMonthlyQuota;

    const canCreate = dailyLimitOk && monthlyLimitOk;

    let message: string | undefined;
    if (!dailyLimitOk) {
      message = `Daily blast limit exceeded. Limit: ${pkg.blastDailyLimit}/day`;
    } else if (!monthlyLimitOk) {
      message = `Monthly blast limit exceeded. Limit: ${pkg.blastMonthlyQuota}/month`;
    }

    return {
      canCreate,
      todayUsed: subscription.todayBlastUsed,
      dailyLimit: pkg.blastDailyLimit,
      monthlyUsed: subscription.usedBlastQuota,
      monthlyLimit: pkg.blastMonthlyQuota,
      message,
    };
  }

  async useBlastLimit(userId: string): Promise<void> {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      throw new BadRequestException('No active subscription');
    }

    const today = new Date().toISOString().split('T')[0];
    const lastBlast = this.getDateString(subscription.lastBlastDate);

    // Reset daily counter if new day
    if (lastBlast !== today) {
      subscription.todayBlastUsed = 0;
      subscription.lastBlastDate = new Date();
    }

    subscription.todayBlastUsed += 1;
    subscription.usedBlastQuota += 1;
    subscription.lastBlastDate = new Date();
    await this.subscriptionRepository.save(subscription);
  }
}
