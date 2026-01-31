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

  @ApiPropertyOptional({ example: 'Starter pack for small business', description: 'Package description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 100000, description: 'Package price' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 30, description: 'Duration in days', default: 30 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  durationDays?: number;

  @ApiPropertyOptional({ example: 1000, description: 'Monthly message quota', default: 1000 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  monthlyQuota?: number;

  @ApiPropertyOptional({ example: 100, description: 'Daily message limit', default: 100 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  dailyLimit?: number;

  @ApiPropertyOptional({ example: true, description: 'Is package active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Sort order', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class UpdatePackageDto {
  @ApiPropertyOptional({ example: 'Basic Plan', description: 'Package name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Starter pack for small business', description: 'Package description' })
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

  @ApiPropertyOptional({ example: 1000, description: 'Monthly message quota' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  monthlyQuota?: number;

  @ApiPropertyOptional({ example: 100, description: 'Daily message limit' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  dailyLimit?: number;

  @ApiPropertyOptional({ example: true, description: 'Is package active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Sort order' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
