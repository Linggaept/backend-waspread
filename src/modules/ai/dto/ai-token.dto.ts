import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AiFeatureType } from '../../../database/entities/ai-token-usage.entity';

export class PurchaseTokenDto {
  @ApiProperty({
    description: 'ID of the token package to purchase',
    example: 'uuid-here',
  })
  @IsUUID()
  packageId: string;
}

export class CreateTokenPackageDto {
  @ApiProperty({ example: '100 Token' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Paket populer untuk penggunaan harian' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  tokenAmount: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bonusTokens?: number;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateTokenPackageDto {
  @ApiPropertyOptional({ example: '100 Token' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Paket populer untuk penggunaan harian' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  tokenAmount?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bonusTokens?: number;

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class TokenUsageQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    enum: AiFeatureType,
    description: 'Filter by feature type',
  })
  @IsOptional()
  @IsEnum(AiFeatureType)
  feature?: AiFeatureType;
}

export class AdminAddTokensDto {
  @ApiProperty({ description: 'User ID to add tokens to' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 100, description: 'Number of tokens to add' })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'Bonus for feedback' })
  @IsOptional()
  @IsString()
  reason?: string;
}
