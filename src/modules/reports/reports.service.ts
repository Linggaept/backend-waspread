import { Injectable, BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import {
  Blast,
  BlastStatus,
  BlastMessage,
} from '../../database/entities/blast.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { Contact } from '../../database/entities/contact.entity';
import { Package } from '../../database/entities/package.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  DashboardStatsDto,
  BlastReportDto,
  MessageReportDto,
  AdminUserReportDto,
  RevenueReportDto,
  ExportTable,
  ExportFormat,
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
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Package)
    private readonly packageRepository: Repository<Package>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getDashboardStats(userId: string): Promise<DashboardStatsDto> {
    // Get blast statistics
    const blasts = await this.blastRepository.find({ where: { userId } });

    const totalBlasts = blasts.length;
    const completedBlasts = blasts.filter(
      (b) => b.status === BlastStatus.COMPLETED,
    ).length;
    const processingBlasts = blasts.filter(
      (b) => b.status === BlastStatus.PROCESSING,
    ).length;
    const cancelledBlasts = blasts.filter(
      (b) => b.status === BlastStatus.CANCELLED,
    ).length;
    const pendingBlasts = blasts.filter(
      (b) => b.status === BlastStatus.PENDING,
    ).length;
    const totalMessagesSent = blasts.reduce((sum, b) => sum + b.sentCount, 0);
    const totalMessagesFailed = blasts.reduce(
      (sum, b) => sum + b.failedCount,
      0,
    );
    const totalMessages = totalMessagesSent + totalMessagesFailed;
    const successRate =
      totalMessages > 0 ? (totalMessagesSent / totalMessages) * 100 : 0;

    // Get subscription info
    const subscription =
      await this.subscriptionsService.getActiveSubscription(userId);
    const quotaCheck = await this.subscriptionsService.checkQuota(userId);
    const aiQuotaCheck = await this.subscriptionsService.checkAiQuota(userId);

    const pkg = subscription?.package;

    // Calculate days remaining
    let daysRemaining: number | undefined;
    if (subscription?.endDate) {
      const now = new Date();
      const end = new Date(subscription.endDate);
      daysRemaining = Math.max(
        0,
        Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }

    return {
      // Subscription Info
      subscription: {
        active: quotaCheck.hasSubscription,
        packageName: pkg?.name,
        expiresAt: subscription?.endDate?.toISOString().split('T')[0],
        daysRemaining,
      },

      // Blast Quota (recipients)
      blastQuota: {
        monthlyLimit: pkg?.blastMonthlyQuota || 0,
        monthlyUsed: subscription?.usedBlastQuota || 0,
        monthlyRemaining: quotaCheck.remainingQuota,
        dailyLimit: pkg?.blastDailyLimit || 0,
        dailyUsed: subscription?.todayBlastUsed || 0,
        dailyRemaining: quotaCheck.remainingDaily,
        isUnlimited:
          pkg?.blastMonthlyQuota === 0 && pkg?.blastDailyLimit === 0,
      },

      // AI Quota
      aiQuota: {
        limit: pkg?.aiQuota || 0,
        used: subscription?.usedAiQuota || 0,
        remaining: aiQuotaCheck.remaining,
        isUnlimited: pkg?.aiQuota === 0,
      },

      // Feature Flags
      features: {
        hasAnalytics: pkg?.hasAnalytics ?? false,
        hasAiFeatures: pkg?.hasAiFeatures ?? false,
        hasLeadScoring: pkg?.hasLeadScoring ?? false,
      },

      // Blast Statistics
      blasts: {
        total: totalBlasts,
        completed: completedBlasts,
        processing: processingBlasts,
        cancelled: cancelledBlasts,
        pending: pendingBlasts,
      },

      // Message Statistics
      messages: {
        totalSent: totalMessagesSent,
        totalFailed: totalMessagesFailed,
        successRate: Math.round(successRate * 100) / 100,
      },
    };
  }

  async getBlastReports(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<BlastReportDto[]> {
    const whereCondition: Record<string, unknown> = { userId };

    if (startDate && endDate) {
      whereCondition.createdAt = Between(
        new Date(startDate),
        new Date(endDate),
      );
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
      const successRate =
        totalProcessed > 0 ? (blast.sentCount / totalProcessed) * 100 : 0;

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

  async getMessageReport(
    userId: string,
    blastId: string,
  ): Promise<MessageReportDto[]> {
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

  async exportAllBlastsToStream(userId: string): Promise<Readable> {
    const BATCH_SIZE = 100;
    const blastRepository = this.blastRepository;

    async function* generate() {
      // Yield header
      yield 'Name,Status,Total Recipients,Sent,Failed,Success Rate,Created At,Started At,Completed At,Duration (s)\n';

      let page = 0;
      while (true) {
        const blasts = await blastRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
          skip: page * BATCH_SIZE,
          take: BATCH_SIZE,
        });

        if (blasts.length === 0) {
          break;
        }

        for (const blast of blasts) {
          const totalProcessed = blast.sentCount + blast.failedCount;
          const successRate =
            totalProcessed > 0 ? (blast.sentCount / totalProcessed) * 100 : 0;
          let durationSeconds = '';

          if (blast.startedAt && blast.completedAt) {
            durationSeconds = Math.round(
              (blast.completedAt.getTime() - blast.startedAt.getTime()) / 1000,
            ).toString();
          }

          const row = [
            blast.name,
            blast.status,
            blast.totalRecipients,
            blast.sentCount,
            blast.failedCount,
            `${Math.round(successRate * 100) / 100}%`,
            blast.createdAt.toISOString(),
            blast.startedAt ? blast.startedAt.toISOString() : '',
            blast.completedAt ? blast.completedAt.toISOString() : '',
            durationSeconds,
          ]
            .map((cell) => `"${cell}"`)
            .join(',');

          yield row + '\n';
        }

        page++;
      }
    }

    return Readable.from(generate());
  }

  // Admin Reports
  async getAdminUserReports(): Promise<AdminUserReportDto[]> {
    const users = await this.userRepository.find({
      order: { createdAt: 'DESC' },
    });

    const reports: AdminUserReportDto[] = [];

    for (const user of users) {
      const blasts = await this.blastRepository.find({
        where: { userId: user.id },
      });
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

    const packageBreakdown = Array.from(packageMap.entries()).map(
      ([name, data]) => ({
        packageName: name,
        count: data.count,
        revenue: data.revenue,
      }),
    );

    const period =
      startDate && endDate
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
    const totalMessagesSent = allBlasts.reduce(
      (sum, b) => sum + b.sentCount,
      0,
    );

    const todayBlasts = await this.blastRepository.count({
      where: { createdAt: MoreThanOrEqual(today) },
    });

    const todayBlastsData = await this.blastRepository.find({
      where: { createdAt: MoreThanOrEqual(today) },
    });
    const todayMessages = todayBlastsData.reduce(
      (sum, b) => sum + b.sentCount,
      0,
    );

    const successfulPayments = await this.paymentRepository.find({
      where: { status: PaymentStatus.SUCCESS },
    });
    const totalRevenue = successfulPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

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

  // ==================== Database Export (Admin) ====================

  async exportTable(
    table: ExportTable,
    format: ExportFormat = ExportFormat.CSV,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: string; filename: string; contentType: string }> {
    let data: any[];
    let headers: string[];
    const timestamp = new Date().toISOString().split('T')[0];

    // Build date filter
    const dateFilter = this.buildDateFilter(startDate, endDate);

    switch (table) {
      case ExportTable.USERS:
        data = await this.exportUsers(dateFilter);
        headers = ['ID', 'Email', 'Name', 'Phone', 'Role', 'Status', 'Created At'];
        break;

      case ExportTable.SUBSCRIPTIONS:
        data = await this.exportSubscriptions(dateFilter);
        headers = [
          'ID', 'User Email', 'Package', 'Status', 'Start Date', 'End Date',
          'Used Blast Quota', 'Used AI Quota', 'Created At',
        ];
        break;

      case ExportTable.PAYMENTS:
        data = await this.exportPayments(dateFilter);
        headers = [
          'ID', 'Order ID', 'User Email', 'Package', 'Amount', 'Status',
          'Payment Type', 'Transaction ID', 'Paid At', 'Created At',
        ];
        break;

      case ExportTable.BLASTS:
        data = await this.exportBlasts(dateFilter);
        headers = [
          'ID', 'User Email', 'Name', 'Status', 'Total Recipients',
          'Sent Count', 'Failed Count', 'Started At', 'Completed At', 'Created At',
        ];
        break;

      case ExportTable.CONTACTS:
        data = await this.exportContacts(dateFilter);
        headers = [
          'ID', 'User Email', 'Phone Number', 'Name', 'Email', 'Notes',
          'Tags', 'Source', 'Is WA Contact', 'Is Active', 'Created At',
        ];
        break;

      case ExportTable.PACKAGES:
        data = await this.exportPackages();
        headers = [
          'ID', 'Name', 'Description', 'Price', 'Duration Days',
          'Blast Monthly Quota', 'Blast Daily Limit', 'AI Quota',
          'Is Active', 'Is Purchasable', 'Has Analytics', 'Has AI Features',
          'Has Lead Scoring', 'Has Followup Feature', 'Created At',
        ];
        break;

      default:
        throw new BadRequestException(`Unknown table: ${table}`);
    }

    const filename = `${table}-export-${timestamp}`;

    if (format === ExportFormat.JSON) {
      return {
        data: JSON.stringify(data, null, 2),
        filename: `${filename}.json`,
        contentType: 'application/json',
      };
    }

    // CSV format
    const csvContent = this.convertToCsv(headers, data);
    return {
      data: csvContent,
      filename: `${filename}.csv`,
      contentType: 'text/csv',
    };
  }

  async exportAllTables(): Promise<{
    data: string;
    filename: string;
    contentType: string;
  }> {
    const timestamp = new Date().toISOString().split('T')[0];

    const exportData = {
      exportedAt: new Date().toISOString(),
      users: await this.exportUsers({}),
      packages: await this.exportPackages(),
      subscriptions: await this.exportSubscriptions({}),
      payments: await this.exportPayments({}),
      blasts: await this.exportBlasts({}),
      contacts: await this.exportContacts({}),
    };

    return {
      data: JSON.stringify(exportData, null, 2),
      filename: `full-database-export-${timestamp}.json`,
      contentType: 'application/json',
    };
  }

  private buildDateFilter(
    startDate?: string,
    endDate?: string,
  ): Record<string, unknown> {
    if (startDate && endDate) {
      return { createdAt: Between(new Date(startDate), new Date(endDate)) };
    } else if (startDate) {
      return { createdAt: MoreThanOrEqual(new Date(startDate)) };
    } else if (endDate) {
      return { createdAt: LessThanOrEqual(new Date(endDate)) };
    }
    return {};
  }

  private async exportUsers(dateFilter: Record<string, unknown>): Promise<any[]> {
    const users = await this.userRepository.find({
      where: dateFilter,
      order: { createdAt: 'DESC' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name || '',
      phone: u.phone || '',
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  private async exportSubscriptions(dateFilter: Record<string, unknown>): Promise<any[]> {
    const subscriptions = await this.subscriptionRepository.find({
      where: dateFilter,
      relations: ['user', 'package'],
      order: { createdAt: 'DESC' },
    });

    return subscriptions.map((s) => ({
      id: s.id,
      userEmail: s.user?.email || '',
      package: s.package?.name || '',
      status: s.status,
      startDate: s.startDate?.toISOString().split('T')[0] || '',
      endDate: s.endDate?.toISOString().split('T')[0] || '',
      usedBlastQuota: s.usedBlastQuota,
      usedAiQuota: s.usedAiQuota,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  private async exportPayments(dateFilter: Record<string, unknown>): Promise<any[]> {
    const payments = await this.paymentRepository.find({
      where: dateFilter,
      relations: ['user', 'package'],
      order: { createdAt: 'DESC' },
    });

    return payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      userEmail: p.user?.email || '',
      package: p.package?.name || '',
      amount: Number(p.amount),
      status: p.status,
      paymentType: p.paymentType || '',
      transactionId: p.transactionId || '',
      paidAt: p.paidAt?.toISOString() || '',
      createdAt: p.createdAt.toISOString(),
    }));
  }

  private async exportBlasts(dateFilter: Record<string, unknown>): Promise<any[]> {
    const blasts = await this.blastRepository.find({
      where: dateFilter,
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    return blasts.map((b) => ({
      id: b.id,
      userEmail: b.user?.email || '',
      name: b.name,
      status: b.status,
      totalRecipients: b.totalRecipients,
      sentCount: b.sentCount,
      failedCount: b.failedCount,
      startedAt: b.startedAt?.toISOString() || '',
      completedAt: b.completedAt?.toISOString() || '',
      createdAt: b.createdAt.toISOString(),
    }));
  }

  private async exportContacts(dateFilter: Record<string, unknown>): Promise<any[]> {
    const contacts = await this.contactRepository.find({
      where: dateFilter,
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    return contacts.map((c) => ({
      id: c.id,
      userEmail: c.user?.email || '',
      phoneNumber: c.phoneNumber,
      name: c.name || '',
      email: c.email || '',
      notes: c.notes || '',
      tags: c.tags?.join(', ') || '',
      source: c.source,
      isWaContact: c.isWaContact,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  private async exportPackages(): Promise<any[]> {
    const packages = await this.packageRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });

    return packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: Number(p.price),
      durationDays: p.durationDays,
      blastMonthlyQuota: p.blastMonthlyQuota,
      blastDailyLimit: p.blastDailyLimit,
      aiQuota: p.aiQuota,
      isActive: p.isActive,
      isPurchasable: p.isPurchasable,
      hasAnalytics: p.hasAnalytics,
      hasAiFeatures: p.hasAiFeatures,
      hasLeadScoring: p.hasLeadScoring,
      hasFollowupFeature: p.hasFollowupFeature,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  private convertToCsv(headers: string[], data: any[]): string {
    const escapeCell = (cell: any): string => {
      if (cell === null || cell === undefined) return '';
      const str = String(cell);
      // Escape double quotes and wrap in quotes if contains comma, newline, or quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerRow = headers.map(escapeCell).join(',');
    const dataRows = data.map((row) =>
      Object.values(row).map(escapeCell).join(','),
    );

    return [headerRow, ...dataRows].join('\n');
  }
}
