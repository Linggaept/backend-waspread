import {
  IsBoolean,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateAutoReplySettingsDto {
  @ApiPropertyOptional({
    description: 'Enable/disable auto-reply feature',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Working hours start time (HH:mm format)',
    example: '08:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'workingHoursStart must be in HH:mm format (e.g., 08:00)',
  })
  workingHoursStart?: string;

  @ApiPropertyOptional({
    description: 'Working hours end time (HH:mm format)',
    example: '21:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'workingHoursEnd must be in HH:mm format (e.g., 21:00)',
  })
  workingHoursEnd?: string;

  @ApiPropertyOptional({
    description: 'Enable working hours restriction (if false, auto-reply 24/7)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  workingHoursEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum delay in seconds before sending reply',
    example: 5,
    minimum: 3,
    maximum: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  @Type(() => Number)
  autoReplyDelayMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum delay in seconds before sending reply',
    example: 10,
    minimum: 3,
    maximum: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(60)
  @Type(() => Number)
  autoReplyDelayMax?: number;

  @ApiPropertyOptional({
    description:
      'Cooldown in minutes before auto-replying to same contact again (0 = no cooldown)',
    example: 60,
    minimum: 0,
    maximum: 1440,
  })
  @IsOptional()
  @IsInt()
  @Min(0) // 0 = no cooldown
  @Max(1440) // 24 hours max
  @Type(() => Number)
  autoReplyCooldownMinutes?: number;

  @ApiPropertyOptional({
    description: 'Fallback message if AI fails to generate reply',
    example:
      'Terima kasih atas pesannya. Kami akan segera membalas pesan Anda.',
  })
  @IsOptional()
  @IsString()
  autoReplyFallbackMessage?: string;
}

export class AddBlacklistDto {
  @ApiProperty({
    description: 'Phone number to blacklist',
    example: '6281234567890',
  })
  @IsString()
  phoneNumber: string;

  @ApiPropertyOptional({
    description: 'Reason for blacklisting',
    example: 'Customer requested no auto-replies',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AutoReplyLogQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by phone number',
    example: '6281234567890',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['queued', 'sent', 'failed', 'skipped'],
  })
  @IsOptional()
  @IsString()
  status?: string;
}
