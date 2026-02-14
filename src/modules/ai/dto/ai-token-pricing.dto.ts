import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTokenPricingDto {
  @ApiProperty({
    description: 'Unique key for this pricing (e.g., "auto_reply", "copywriting")',
    example: 'auto_reply_image',
  })
  @IsString()
  key: string;

  @ApiPropertyOptional({
    description: 'Divisor: Gemini tokens / divisor = base platform tokens. Higher = cheaper for user.',
    example: 3450,
    default: 3450,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  @Type(() => Number)
  divisor?: number;

  @ApiPropertyOptional({
    description: 'Markup multiplier (1.0 = no markup, 1.5 = 50% markup)',
    example: 1.0,
    default: 1.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @Type(() => Number)
  markup?: number;

  @ApiPropertyOptional({
    description: 'Minimum tokens to charge per request (supports decimals)',
    example: 0.01,
    default: 0.01,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  @Type(() => Number)
  minTokens?: number;

  @ApiPropertyOptional({
    description: 'Description for this pricing config',
    example: 'Pricing for image-based auto-reply',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateTokenPricingDto {
  @ApiPropertyOptional({
    description: 'Divisor: Gemini tokens / divisor = base platform tokens. Higher = cheaper for user.',
    example: 3450,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  @Type(() => Number)
  divisor?: number;

  @ApiPropertyOptional({
    description: 'Markup multiplier (1.0 = no markup, 1.5 = 50% markup)',
    example: 1.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @Type(() => Number)
  markup?: number;

  @ApiPropertyOptional({
    description: 'Minimum tokens to charge per request (supports decimals)',
    example: 0.01,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  @Type(() => Number)
  minTokens?: number;

  @ApiPropertyOptional({
    description: 'Enable/disable this pricing config',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Description for this pricing config',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
