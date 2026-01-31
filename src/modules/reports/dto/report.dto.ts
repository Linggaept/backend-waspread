import { IsOptional, IsDateString } from 'class-validator';

export class DateRangeDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class DashboardStatsDto {
  totalBlasts: number;
  completedBlasts: number;
  processingBlasts: number;
  cancelledBlasts: number;
  totalMessagesSent: number;
  totalMessagesFailed: number;
  successRate: number;
  quotaUsed: number;
  quotaRemaining: number;
  activeSubscription: boolean;
}

export class BlastReportDto {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  successRate: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  durationSeconds?: number;
}

export class MessageReportDto {
  id: string;
  blastName: string;
  phoneNumber: string;
  status: string;
  sentAt?: Date;
  errorMessage?: string;
}

export class AdminUserReportDto {
  userId: string;
  email: string;
  name: string;
  totalBlasts: number;
  totalMessagesSent: number;
  currentPlan?: string;
  subscriptionStatus?: string;
  lastActivityAt?: Date;
}

export class RevenueReportDto {
  period: string;
  totalPayments: number;
  successfulPayments: number;
  totalRevenue: number;
  packageBreakdown: {
    packageName: string;
    count: number;
    revenue: number;
  }[];
}
