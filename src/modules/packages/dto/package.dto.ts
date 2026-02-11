import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePackageDto {
  @ApiProperty({ example: 'Basic Plan', description: 'Package name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Starter pack for small business',
    description: 'Package description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 100000, description: 'Package price' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Duration in days',
    default: 30,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  durationDays?: number;

  // Blast Quota (recipients per period)
  @ApiPropertyOptional({
    example: 5000,
    description: 'Monthly blast recipients quota (0 = unlimited)',
    default: 1000,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  blastMonthlyQuota?: number;

  @ApiPropertyOptional({
    example: 500,
    description: 'Daily blast recipients limit (0 = unlimited)',
    default: 100,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  blastDailyLimit?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Is package active',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Can users purchase this package (false = display only)',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isPurchasable?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Mark as popular package (show badge)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isPopular?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Is this package on discount',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isDiscount?: boolean;

  @ApiPropertyOptional({
    example: 150000,
    description: 'Original price before discount (required if isDiscount=true)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  originalPrice?: number;

  @ApiPropertyOptional({ example: 1, description: 'Sort order', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'AI quota (0 = unlimited)',
    default: 0,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  aiQuota?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Has analytics feature',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  hasAnalytics?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has AI features (copywriting, smart reply)',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  hasAiFeatures?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has lead scoring feature',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  hasLeadScoring?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has followup feature',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  hasFollowupFeature?: boolean;
}

export class UpdatePackageDto {
  @ApiPropertyOptional({ example: 'Basic Plan', description: 'Package name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    example: 'Starter pack for small business',
    description: 'Package description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 100000, description: 'Package price' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 30, description: 'Duration in days' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  durationDays?: number;

  // Blast Quota (recipients per period)
  @ApiPropertyOptional({
    example: 5000,
    description: 'Monthly blast recipients quota (0 = unlimited)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  blastMonthlyQuota?: number;

  @ApiPropertyOptional({
    example: 500,
    description: 'Daily blast recipients limit (0 = unlimited)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  blastDailyLimit?: number;

  @ApiPropertyOptional({ example: true, description: 'Is package active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Can users purchase this package (false = display only)',
  })
  @IsBoolean()
  @IsOptional()
  isPurchasable?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Mark as popular package (show badge)',
  })
  @IsBoolean()
  @IsOptional()
  isPopular?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Is this package on discount',
  })
  @IsBoolean()
  @IsOptional()
  isDiscount?: boolean;

  @ApiPropertyOptional({
    example: 150000,
    description: 'Original price before discount',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  originalPrice?: number;

  @ApiPropertyOptional({ example: 1, description: 'Sort order' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'AI quota (0 = unlimited)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  aiQuota?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Has analytics feature',
  })
  @IsBoolean()
  @IsOptional()
  hasAnalytics?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has AI features (copywriting, smart reply)',
  })
  @IsBoolean()
  @IsOptional()
  hasAiFeatures?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has lead scoring feature',
  })
  @IsBoolean()
  @IsOptional()
  hasLeadScoring?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Has followup feature',
  })
  @IsBoolean()
  @IsOptional()
  hasFollowupFeature?: boolean;
}
