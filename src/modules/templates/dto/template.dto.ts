import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  MinLength,
  MaxLength,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Promo Template', description: 'Template name' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'Halo {name}! Ada promo spesial untuk kamu hari ini.',
    description: 'Message content. Use {variable} for placeholders.',
  })
  @IsString()
  @MinLength(1)
  message: string;

  @ApiPropertyOptional({
    example: 'promo',
    description: 'Category for organizing templates',
  })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    example: ['name', 'product'],
    description:
      'List of variable names used in message (auto-detected from {variable} patterns)',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
    }
    return value;
  })
  variables?: string[];

  // File field - handled by file interceptor
  @Allow()
  @IsOptional()
  mediaFile?: any;
}

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {
  @ApiPropertyOptional({ example: true, description: 'Is template active' })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true';
    }
    return value;
  })
  isActive?: boolean;
}

export class TemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional({ description: 'Media file URL' })
  mediaUrl?: string;

  @ApiPropertyOptional({
    enum: ['image', 'video', 'audio', 'document'],
    description: 'Type of media',
  })
  mediaType?: string;

  @ApiPropertyOptional()
  category?: string;

  @ApiPropertyOptional({ type: [String] })
  variables?: string[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  usageCount: number;

  @ApiPropertyOptional()
  lastUsedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TemplateQueryDto {
  @ApiPropertyOptional({ example: 'promo', description: 'Search by name' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'promo', description: 'Filter by category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by active status',
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return value;
  })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value) || 1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => Math.min(parseInt(value) || 20, 100))
  limit?: number;
}

export class UseTemplateDto {
  @ApiProperty({ example: 'template-uuid', description: 'Template ID to use' })
  @IsString()
  templateId: string;

  @ApiPropertyOptional({
    example: { name: 'John', product: 'Laptop' },
    description: 'Variable values to replace in message',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  variableValues?: Record<string, string>;
}
