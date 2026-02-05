import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '../../../database/entities/subscription.entity';

export enum SubscriptionSortBy {
  CREATED_AT = 'createdAt',
  START_DATE = 'startDate',
  END_DATE = 'endDate',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SubscriptionQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search by user email or name' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    description: 'Filter by status',
  })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @ApiPropertyOptional({
    enum: SubscriptionSortBy,
    default: SubscriptionSortBy.CREATED_AT,
  })
  @IsEnum(SubscriptionSortBy)
  @IsOptional()
  sortBy?: SubscriptionSortBy = SubscriptionSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;
}
