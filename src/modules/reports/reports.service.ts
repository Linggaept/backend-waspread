import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Blast, BlastStatus, BlastMessage } from '../../database/entities/blast.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  DashboardStatsDto,
  BlastReportDto,
  MessageReportDto,
  AdminUserReportDto,
  RevenueReportDto,
} from './dto';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    @InjectRepository(BlastMessage)
    private readonly messageRepository: Repository<BlastMessage>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getDashboardStats(userId: string): Promise<DashboardStatsDto> {
    const blasts = await this.blastRepository.find({ where: { userId } });

    const totalBlasts = blasts.length;
    const completedBlasts = blasts.filter((b) => b.status === BlastStatus.COMPLETED).length;
    const processingBlasts = blasts.filter((b) => b.status === BlastStatus.PROCESSING).length;
    const cancelledBlasts = blasts.filter((b) => b.status === BlastStatus.CANCELLED).length;
    const totalMessagesSent = blasts.reduce((sum, b) => sum + b.sentCount, 0);
    const totalMessagesFailed = blasts.reduce((sum, b) => sum + b.failedCount, 0);
    const totalMessages = totalMessagesSent + totalMessagesFailed;
    const successRate = totalMessages > 0 ? (totalMessagesSent / totalMessages) * 100 : 0;

    // Get subscription info
    const subscription = await this.subscriptionsService.getActiveSubscription(userId);
    const quotaCheck = await this.subscriptionsService.checkQuota(userId);

    return {
      totalBlasts,
      completedBlasts,
      processingBlasts,
      cancelledBlasts,
      totalMessagesSent,
      totalMessagesFailed,
      successRate: Math.round(successRate * 100) / 100,
      quotaUsed: subscription?.usedQuota || 0,
      quotaRemaining: quotaCheck.remainingQuota,
      activeSubscription: quotaCheck.hasSubscription,
    };
  }

  async getBlastReports(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<BlastReportDto[]> {
    const whereCondition: Record<string, unknown> = { userId };

    if (startDate && endDate) {
      whereCondition.createdAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      whereCondition.createdAt = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      whereCondition.createdAt = LessThanOrEqual(new Date(endDate));
    }

    const blasts = await this.blastRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    return blasts.map((blast) => {
      const totalProcessed = blast.sentCount + blast.failedCount;
      const successRate = totalProcessed > 0 ? (blast.sentCount / totalProcessed) * 100 : 0;
      
      let durationSeconds: number | undefined;
      if (blast.startedAt && blast.completedAt) {
        durationSeconds = Math.round(
          (blast.completedAt.getTime() - blast.startedAt.getTime()) / 1000,
        );
      }

      return {
        id: blast.id,
        name: blast.name,
        status: blast.status,
        totalRecipients: blast.totalRecipients,
        sentCount: blast.sentCount,
        failedCount: blast.failedCount,
        successRate: Math.round(successRate * 100) / 100,
        createdAt: blast.createdAt,
        startedAt: blast.startedAt,
        completedAt: blast.completedAt,
        durationSeconds,
      };
    });
  }

  async getMessageReport(userId: string, blastId: string): Promise<MessageReportDto[]> {
    // Verify blast ownership
    const blast = await this.blastRepository.findOne({
      where: { id: blastId, userId },
    });

    if (!blast) {
      return [];
    }

    const messages = await this.messageRepository.find({
      where: { blastId },
      order: { createdAt: 'ASC' },
    });

    return messages.map((msg) => ({
      id: msg.id,
      blastName: blast.name,
      phoneNumber: msg.phoneNumber,
      status: msg.status,
      sentAt: msg.sentAt,
      errorMessage: msg.errorMessage,
    }));
  }

  async exportBlastToCsv(userId: string, blastId: string): Promise<string> {
    const messages = await this.getMessageReport(userId, blastId);

    if (messages.length === 0) {
      return '';
    }

    const headers = ['Phone Number', 'Status', 'Sent At', 'Error Message'];
    const rows = messages.map((msg) => [
      msg.phoneNumber,
      msg.status,
      msg.sentAt ? msg.sentAt.toISOString() : '',
      msg.errorMessage || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  async exportAllBlastsToCsv(userId: string): Promise<string> {
    const blasts = await this.getBlastReports(userId);

    if (blasts.length === 0) {
      return '';
    }

    const headers = [
      'Name',
      'Status',
      'Total Recipients',
      'Sent',
      'Failed',
      'Success Rate',
      'Created At',
      'Started At',
      'Completed At',
      'Duration (s)',
    ];

    const rows = blasts.map((blast) => [
      blast.name,
      blast.status,
      blast.totalRecipients.toString(),
      blast.sentCount.toString(),
      blast.failedCount.toString(),
      `${blast.successRate}%`,
      blast.createdAt.toISOString(),
      blast.startedAt ? blast.startedAt.toISOString() : '',
      blast.completedAt ? blast.completedAt.toISOString() : '',
      blast.durationSeconds?.toString() || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  // Admin Reports
  async getAdminUserReports(): Promise<AdminUserReportDto[]> {
    const users = await this.userRepository.find({
      order: { createdAt: 'DESC' },
    });

    const reports: AdminUserReportDto[] = [];

    for (const user of users) {
      const blasts = await this.blastRepository.find({ where: { userId: user.id } });
      const subscription = await this.subscriptionRepository.findOne({
        where: { userId: user.id },
        relations: ['package'],
        order: { createdAt: 'DESC' },
      });

      const lastBlast = blasts.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];

      reports.push({
        userId: user.id,
        email: user.email,
        name: user.name || '',
        totalBlasts: blasts.length,
        totalMessagesSent: blasts.reduce((sum, b) => sum + b.sentCount, 0),
        currentPlan: subscription?.package?.name,
        subscriptionStatus: subscription?.status,
        lastActivityAt: lastBlast?.createdAt,
      });
    }

    return reports;
  }

  async getRevenueReport(
    startDate?: string,
    endDate?: string,
  ): Promise<RevenueReportDto> {
    const whereCondition: Record<string, unknown> = {
      status: PaymentStatus.SUCCESS,
    };

    if (startDate && endDate) {
      whereCondition.paidAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      whereCondition.paidAt = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      whereCondition.paidAt = LessThanOrEqual(new Date(endDate));
    }

    const payments = await this.paymentRepository.find({
      where: whereCondition,
      relations: ['package'],
    });

    const totalPayments = payments.length;
    const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    // Group by package
    const packageMap = new Map<string, { count: number; revenue: number }>();
    for (const payment of payments) {
      const packageName = payment.package?.name || 'Unknown';
      const existing = packageMap.get(packageName) || { count: 0, revenue: 0 };
      existing.count += 1;
      existing.revenue += Number(payment.amount);
      packageMap.set(packageName, existing);
    }

    const packageBreakdown = Array.from(packageMap.entries()).map(([name, data]) => ({
      packageName: name,
      count: data.count,
      revenue: data.revenue,
    }));

    const period = startDate && endDate
      ? `${startDate} to ${endDate}`
      : startDate
      ? `From ${startDate}`
      : endDate
      ? `Until ${endDate}`
      : 'All time';

    return {
      period,
      totalPayments,
      successfulPayments: totalPayments,
      totalRevenue,
      packageBreakdown,
    };
  }

  async getAdminDashboard(): Promise<{
    totalUsers: number;
    activeSubscriptions: number;
    totalBlasts: number;
    totalMessagesSent: number;
    totalRevenue: number;
    todayBlasts: number;
    todayMessages: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalUsers = await this.userRepository.count();
    const activeSubscriptions = await this.subscriptionRepository.count({
      where: { status: 'active' as never },
    });

    const allBlasts = await this.blastRepository.find();
    const totalBlasts = allBlasts.length;
    const totalMessagesSent = allBlasts.reduce((sum, b) => sum + b.sentCount, 0);

    const todayBlasts = await this.blastRepository.count({
      where: { createdAt: MoreThanOrEqual(today) },
    });

    const todayBlastsData = await this.blastRepository.find({
      where: { createdAt: MoreThanOrEqual(today) },
    });
    const todayMessages = todayBlastsData.reduce((sum, b) => sum + b.sentCount, 0);

    const successfulPayments = await this.paymentRepository.find({
      where: { status: PaymentStatus.SUCCESS },
    });
    const totalRevenue = successfulPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    return {
      totalUsers,
      activeSubscriptions,
      totalBlasts,
      totalMessagesSent,
      totalRevenue,
      todayBlasts,
      todayMessages,
    };
  }
}
