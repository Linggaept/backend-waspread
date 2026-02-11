import {
  IsString,
  IsUUID,
  IsEnum,
  IsNumber,
  IsArray,
  IsOptional,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  FollowupTrigger,
  FollowupStatus,
} from '../../../database/entities/followup-campaign.entity';
import { FollowupMessageStatus } from '../../../database/entities/followup-message.entity';
import { ContactFollowupStatus } from '../../../database/entities/contact-followup.entity';

export class FollowupStepDto {
  @ApiProperty({ example: 1, description: 'Step number (1-based)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  step: number;

  @ApiProperty({
    example: 'Halo! Apakah ada pertanyaan tentang promo kami?',
    description: 'Message content for this step',
  })
  @IsString()
  message: string;

  @ApiProperty({
    example: 24,
    description: 'Delay in hours from previous step (or from trigger condition). Use 0.0167 for ~1 minute testing.',
  })
  @IsNumber()
  @Min(0.0167) // ~1 minute for testing
  @Max(168) // Max 7 days
  delayHours: number;
}

export class CreateFollowupDto {
  @ApiProperty({ example: 'Reminder Promo', description: 'Campaign name' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'uuid-of-original-blast',
    description: 'ID of the original blast campaign',
  })
  @IsUUID()
  originalBlastId: string;

  @ApiProperty({
    enum: FollowupTrigger,
    example: FollowupTrigger.NO_REPLY,
    description: 'Trigger condition for follow-up',
  })
  @IsEnum(FollowupTrigger)
  trigger: FollowupTrigger;

  @ApiProperty({
    example: 24,
    description: 'Initial delay in hours before first follow-up. Use 0.0167 for ~1 minute testing.',
    minimum: 0.0167,
    maximum: 168,
  })
  @IsNumber()
  @Min(0.0167) // ~1 minute for testing
  @Max(168)
  delayHours: number;

  @ApiProperty({
    type: [FollowupStepDto],
    description: 'Follow-up message steps',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowupStepDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  messages: FollowupStepDto[];

  @ApiProperty({
    example: 2,
    description: 'Maximum number of follow-ups per recipient',
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  maxFollowups: number;
}

export class UpdateFollowupDto {
  @ApiPropertyOptional({ example: 'Updated Campaign Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: FollowupStatus })
  @IsOptional()
  @IsEnum(FollowupStatus)
  status?: FollowupStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [FollowupStepDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowupStepDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  messages?: FollowupStepDto[];

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  maxFollowups?: number;

  @ApiPropertyOptional({ minimum: 0.0167, maximum: 168 })
  @IsOptional()
  @IsNumber()
  @Min(0.0167)
  @Max(168)
  delayHours?: number;
}

export class FollowupQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 1)
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 10)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search by name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: FollowupStatus })
  @IsOptional()
  @IsEnum(FollowupStatus)
  status?: FollowupStatus;
}

export class FollowupMessageQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 20)
  limit?: number;

  @ApiPropertyOptional({ enum: FollowupMessageStatus })
  @IsOptional()
  @IsEnum(FollowupMessageStatus)
  status?: FollowupMessageStatus;
}

export class FollowupCampaignResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  originalBlastId: string;

  @ApiPropertyOptional()
  originalBlastName?: string;

  @ApiProperty({ enum: FollowupTrigger })
  trigger: FollowupTrigger;

  @ApiProperty()
  delayHours: number;

  @ApiProperty({ type: [FollowupStepDto] })
  messages: FollowupStepDto[];

  @ApiProperty()
  maxFollowups: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ enum: FollowupStatus })
  status: FollowupStatus;

  @ApiProperty()
  totalScheduled: number;

  @ApiProperty()
  totalSent: number;

  @ApiProperty()
  totalSkipped: number;

  @ApiProperty()
  totalFailed: number;

  @ApiProperty()
  totalReplied: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class FollowupMessageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  phoneNumber: string;

  @ApiProperty()
  step: number;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: FollowupMessageStatus })
  status: FollowupMessageStatus;

  @ApiProperty()
  scheduledAt: Date;

  @ApiPropertyOptional()
  sentAt?: Date;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  createdAt: Date;
}

export class FollowupStatsDto {
  @ApiProperty()
  totalCampaigns: number;

  @ApiProperty()
  activeCampaigns: number;

  @ApiProperty()
  totalScheduled: number;

  @ApiProperty()
  totalSent: number;

  @ApiProperty()
  totalSkipped: number;

  @ApiProperty()
  totalFailed: number;

  @ApiProperty()
  conversionRate: number;
}

// ==================== Contact Followup DTOs ====================

export class CreateContactFollowupDto {
  @ApiProperty({
    example: '628123456789',
    description: 'Phone number to follow up',
  })
  @IsString()
  phoneNumber: string;

  @ApiProperty({
    example: 'Halo, ada yang bisa saya bantu?',
    description: 'Follow-up message to send',
  })
  @IsString()
  message: string;

  @ApiProperty({
    example: 1,
    description: 'Delay in hours. Use 0.0167 for ~1 minute.',
  })
  @IsNumber()
  @Min(0.0167)
  @Max(168)
  delayHours: number;
}
