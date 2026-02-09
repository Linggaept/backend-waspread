import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '../../../database/entities/audit-log.entity';

export class AuditLogQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({
    enum: AuditAction,
    description: 'Filter by action type',
  })
  @IsEnum(AuditAction)
  @IsOptional()
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'Search by user email or metadata' })
  @IsString()
  @IsOptional()
  search?: string;
}
