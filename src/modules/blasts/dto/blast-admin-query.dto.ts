import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BlastStatus } from '../../../database/entities/blast.entity';

export enum BlastSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  NAME = 'name',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class BlastAdminQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by blast name or user email' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: BlastStatus, description: 'Filter by status' })
  @IsEnum(BlastStatus)
  @IsOptional()
  status?: BlastStatus;

  @ApiPropertyOptional({ enum: BlastSortBy, default: BlastSortBy.CREATED_AT })
  @IsEnum(BlastSortBy)
  @IsOptional()
  sortBy?: BlastSortBy = BlastSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;
}
