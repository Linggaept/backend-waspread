import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ExportTable {
  USERS = 'users',
  SUBSCRIPTIONS = 'subscriptions',
  PAYMENTS = 'payments',
  BLASTS = 'blasts',
  CONTACTS = 'contacts',
  PACKAGES = 'packages',
}

export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json',
}

export class DateRangeDto {
  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Start date (ISO8601)',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-01-31',
    description: 'End date (ISO8601)',
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

// Subscription & Package Info
class SubscriptionInfoDto {
  @ApiProperty({ example: true }) active: boolean;
  @ApiPropertyOptional({ example: 'Pro Plan' }) packageName?: string;
  @ApiPropertyOptional({ example: '2026-02-28' }) expiresAt?: string;
  @ApiPropertyOptional({ example: 15 }) daysRemaining?: number;
}

// Blast Quota (recipients that can receive blast messages)
class BlastQuotaDto {
  @ApiProperty({
    example: 5000,
    description: 'Total blast recipients allowed per month (0 = unlimited)',
  })
  monthlyLimit: number;

  @ApiProperty({ example: 1250, description: 'Recipients blasted this month' })
  monthlyUsed: number;

  @ApiProperty({
    example: 3750,
    description: 'Remaining recipients this month (-1 = unlimited)',
  })
  monthlyRemaining: number;

  @ApiProperty({
    example: 500,
    description: 'Max blast recipients per day (0 = unlimited)',
  })
  dailyLimit: number;

  @ApiProperty({ example: 120, description: 'Recipients blasted today' })
  dailyUsed: number;

  @ApiProperty({
    example: 380,
    description: 'Remaining recipients today (-1 = unlimited)',
  })
  dailyRemaining: number;

  @ApiProperty({ example: false }) isUnlimited: boolean;
}

// AI Quota
class AiQuotaDto {
  @ApiProperty({ example: 100, description: 'Total AI quota (0 = unlimited)' })
  limit: number;

  @ApiProperty({ example: 25, description: 'Used AI calls' })
  used: number;

  @ApiProperty({
    example: 75,
    description: 'Remaining AI calls (-1 = unlimited)',
  })
  remaining: number;

  @ApiProperty({ example: false }) isUnlimited: boolean;
}

// Feature Flags
class FeatureFlagsDto {
  @ApiProperty({ example: true }) hasAnalytics: boolean;
  @ApiProperty({ example: true }) hasAiFeatures: boolean;
  @ApiProperty({ example: true }) hasLeadScoring: boolean;
}

// Blast Statistics
class BlastStatsDto {
  @ApiProperty({ example: 10 }) total: number;
  @ApiProperty({ example: 8 }) completed: number;
  @ApiProperty({ example: 1 }) processing: number;
  @ApiProperty({ example: 1 }) cancelled: number;
  @ApiProperty({ example: 0 }) pending: number;
}

// Message Statistics
class MessageStatsDto {
  @ApiProperty({ example: 5000 }) totalSent: number;
  @ApiProperty({ example: 150 }) totalFailed: number;
  @ApiProperty({ example: 97.09 }) successRate: number;
}

export class DashboardStatsDto {
  // Subscription Info
  @ApiProperty({ type: SubscriptionInfoDto })
  subscription: SubscriptionInfoDto;

  // Blast Quota (recipients)
  @ApiProperty({ type: BlastQuotaDto })
  blastQuota: BlastQuotaDto;

  // AI Quota
  @ApiProperty({ type: AiQuotaDto })
  aiQuota: AiQuotaDto;

  // Feature Flags
  @ApiProperty({ type: FeatureFlagsDto })
  features: FeatureFlagsDto;

  // Blast Statistics
  @ApiProperty({ type: BlastStatsDto })
  blasts: BlastStatsDto;

  // Message Statistics
  @ApiProperty({ type: MessageStatsDto })
  messages: MessageStatsDto;
}

export class BlastReportDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty() totalRecipients: number;
  @ApiProperty() sentCount: number;
  @ApiProperty() failedCount: number;
  @ApiProperty() successRate: number;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional() startedAt?: Date;
  @ApiPropertyOptional() completedAt?: Date;
  @ApiPropertyOptional() durationSeconds?: number;
}

export class MessageReportDto {
  @ApiProperty() id: string;
  @ApiProperty() blastName: string;
  @ApiProperty() phoneNumber: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional() sentAt?: Date;
  @ApiPropertyOptional() errorMessage?: string;
}

export class AdminUserReportDto {
  @ApiProperty() userId: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty() totalBlasts: number;
  @ApiProperty() totalMessagesSent: number;
  @ApiPropertyOptional() currentPlan?: string;
  @ApiPropertyOptional() subscriptionStatus?: string;
  @ApiPropertyOptional() lastActivityAt?: Date;
}

class PackageBreakdownDto {
  @ApiProperty() packageName: string;
  @ApiProperty() count: number;
  @ApiProperty() revenue: number;
}

export class RevenueReportDto {
  @ApiProperty() period: string;
  @ApiProperty() totalPayments: number;
  @ApiProperty() successfulPayments: number;
  @ApiProperty() totalRevenue: number;
  @ApiProperty({ type: [PackageBreakdownDto] })
  packageBreakdown: PackageBreakdownDto[];
}

export class ExportQueryDto {
  @ApiProperty({
    enum: ExportTable,
    example: ExportTable.USERS,
    description: 'Table to export',
  })
  @IsEnum(ExportTable)
  table: ExportTable;

  @ApiPropertyOptional({
    enum: ExportFormat,
    example: ExportFormat.CSV,
    description: 'Export format (default: csv)',
    default: ExportFormat.CSV,
  })
  @IsEnum(ExportFormat)
  @IsOptional()
  format?: ExportFormat = ExportFormat.CSV;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Start date filter (ISO8601)',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-01-31',
    description: 'End date filter (ISO8601)',
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
