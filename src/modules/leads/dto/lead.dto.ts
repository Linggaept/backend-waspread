import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadScoreLevel } from '../../../database/entities/lead-score.entity';

export class LeadQueryDto {
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
    description: 'Filter by score level',
    enum: LeadScoreLevel,
  })
  @IsOptional()
  @IsEnum(LeadScoreLevel)
  score?: LeadScoreLevel;

  @ApiPropertyOptional({ description: 'Search by phone number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['lastInteraction', 'score', 'totalMessages'],
    default: 'lastInteraction',
  })
  @IsOptional()
  @IsString()
  sortBy?: 'lastInteraction' | 'score' | 'totalMessages' = 'lastInteraction';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class ManualScoreOverrideDto {
  @ApiProperty({
    description: 'New score level',
    enum: LeadScoreLevel,
    example: 'hot',
  })
  @IsEnum(LeadScoreLevel)
  @IsNotEmpty()
  score: LeadScoreLevel;

  @ApiPropertyOptional({
    description: 'Reason for manual override',
    example: 'Customer confirmed purchase via phone call',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkOverrideItemDto {
  @ApiProperty({
    description: 'Phone number to override',
    example: '628123456789',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({
    description: 'New score level',
    enum: LeadScoreLevel,
    example: 'hot',
  })
  @IsEnum(LeadScoreLevel)
  @IsNotEmpty()
  score: LeadScoreLevel;

  @ApiPropertyOptional({
    description: 'Reason for manual override',
    example: 'Bulk promotion campaign target',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkScoreOverrideDto {
  @ApiProperty({
    description: 'Array of leads to override',
    type: [BulkOverrideItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkOverrideItemDto)
  leads: BulkOverrideItemDto[];
}

export class RecalculateDto {
  @ApiPropertyOptional({
    description: 'Specific phone numbers to recalculate (empty = all)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneNumbers?: string[];
}
