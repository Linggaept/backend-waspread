import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum AnalyticsPeriod {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7_DAYS = '7d',
  LAST_30_DAYS = '30d',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
  CUSTOM = 'custom',
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Time period for analytics',
    enum: AnalyticsPeriod,
    default: AnalyticsPeriod.LAST_7_DAYS,
  })
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod = AnalyticsPeriod.LAST_7_DAYS;

  @ApiPropertyOptional({
    description: 'Start date for custom period (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for custom period (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific blast ID',
  })
  @IsOptional()
  @IsString()
  blastId?: string;
}

export class FunnelQueryDto extends AnalyticsQueryDto {
  // blastId is already defined in AnalyticsQueryDto
}

export class TrendsQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Group by interval',
    enum: ['day', 'week', 'month'],
    default: 'day',
  })
  @IsOptional()
  @IsString()
  groupBy?: 'day' | 'week' | 'month' = 'day';
}

export class UnrepliedQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Minimum waiting hours to filter',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minWaitingHours?: number = 0;
}

export class ConversationListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by funnel stage' })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({ description: 'Filter by blast ID' })
  @IsOptional()
  @IsString()
  blastId?: string;

  @ApiPropertyOptional({ description: 'Search by phone number' })
  @IsOptional()
  @IsString()
  search?: string;
}
