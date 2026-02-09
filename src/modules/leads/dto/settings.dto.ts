import {
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLeadScoreSettingsDto {
  @ApiPropertyOptional({ description: 'Enable/disable lead scoring' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  // Keyword settings
  @ApiPropertyOptional({
    description: 'Keywords indicating hot leads',
    example: ['beli', 'order', 'transfer', 'bayar'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hotKeywords?: string[];

  @ApiPropertyOptional({
    description: 'Keywords indicating warm leads',
    example: ['harga', 'promo', 'diskon', 'info'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warmKeywords?: string[];

  @ApiPropertyOptional({
    description: 'Weight for keyword factor (0-100)',
    example: 40,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  keywordWeight?: number;

  // Response time settings
  @ApiPropertyOptional({
    description: 'Enable response time factor',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  responseTimeEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Response time threshold for hot leads (in minutes)',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hotResponseTimeMinutes?: number;

  @ApiPropertyOptional({
    description: 'Response time threshold for warm leads (in minutes)',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warmResponseTimeMinutes?: number;

  @ApiPropertyOptional({
    description: 'Weight for response time factor (0-100)',
    example: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  responseTimeWeight?: number;

  // Engagement settings
  @ApiPropertyOptional({
    description: 'Enable engagement factor',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  engagementEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Message count threshold for hot leads',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hotMessageCount?: number;

  @ApiPropertyOptional({
    description: 'Message count threshold for warm leads',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warmMessageCount?: number;

  @ApiPropertyOptional({
    description: 'Weight for engagement factor (0-100)',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  engagementWeight?: number;

  // Recency settings
  @ApiPropertyOptional({
    description: 'Enable recency factor',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  recencyEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Activity recency threshold for hot leads (in hours)',
    example: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hotRecencyHours?: number;

  @ApiPropertyOptional({
    description: 'Activity recency threshold for warm leads (in hours)',
    example: 72,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warmRecencyHours?: number;

  @ApiPropertyOptional({
    description: 'Weight for recency factor (0-100)',
    example: 15,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  recencyWeight?: number;

  // Thresholds
  @ApiPropertyOptional({
    description: 'Score threshold for hot leads (0-100)',
    example: 70,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  hotThreshold?: number;

  @ApiPropertyOptional({
    description: 'Score threshold for warm leads (0-100)',
    example: 40,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  warmThreshold?: number;
}
