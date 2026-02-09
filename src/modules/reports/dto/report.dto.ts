import { IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class DashboardStatsDto {
  @ApiProperty() totalBlasts: number;
  @ApiProperty() completedBlasts: number;
  @ApiProperty() processingBlasts: number;
  @ApiProperty() cancelledBlasts: number;
  @ApiProperty() totalMessagesSent: number;
  @ApiProperty() totalMessagesFailed: number;
  @ApiProperty() successRate: number;
  @ApiProperty() quotaUsed: number;
  @ApiProperty() quotaRemaining: number;
  @ApiProperty() activeSubscription: boolean;
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
