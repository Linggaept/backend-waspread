import { IsOptional, IsString, IsInt, Min, IsEnum, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../../../database/entities/whatsapp-session.entity';

export enum SessionSortBy {
  UPDATED_AT = 'updatedAt',
  CREATED_AT = 'createdAt',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SessionQueryDto {
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
  @Max(100)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search by user email or phone number' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: SessionStatus, description: 'Filter by status' })
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @ApiPropertyOptional({
    enum: SessionSortBy,
    default: SessionSortBy.UPDATED_AT,
  })
  @IsEnum(SessionSortBy)
  @IsOptional()
  sortBy?: SessionSortBy = SessionSortBy.UPDATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;
}
