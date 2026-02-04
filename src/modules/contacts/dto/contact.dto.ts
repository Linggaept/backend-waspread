import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEmail,
  MinLength,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateContactDto {
  @ApiProperty({ example: '628123456789', description: 'WhatsApp phone number' })
  @IsString()
  @MinLength(10)
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Contact name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'john@example.com', description: 'Email address' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'VIP customer', description: 'Notes about the contact' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    example: ['customer', 'vip'],
    description: 'Tags for categorization',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    return value;
  })
  tags?: string[];
}

export class UpdateContactDto extends PartialType(CreateContactDto) {
  @ApiPropertyOptional({ example: true, description: 'Is contact active' })
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

export class ImportContactsDto {
  @ApiPropertyOptional({
    example: ['customer'],
    description: 'Tags to apply to all imported contacts',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      if (value === '') return undefined;
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }
    return value;
  })
  tags?: string[];

  @ApiPropertyOptional({
    example: true,
    description: 'Skip duplicate phone numbers instead of failing',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value !== 'false';
    }
    return value ?? true;
  })
  skipDuplicates?: boolean;

  // File field - handled by file interceptor
  @Allow()
  @IsOptional()
  file?: any;
}

export class ContactResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  phoneNumber: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  tags?: string[];

  @ApiProperty({ enum: ['manual', 'whatsapp', 'import'], example: 'whatsapp' })
  source: string;

  @ApiPropertyOptional({ description: 'WhatsApp profile name (pushname)' })
  waName?: string;

  @ApiProperty({ description: 'Is registered on WhatsApp' })
  isWaContact: boolean;

  @ApiPropertyOptional({ description: 'Last synced from WhatsApp' })
  lastSyncedAt?: Date;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ImportResultDto {
  @ApiProperty({ example: 100 })
  totalProcessed: number;

  @ApiProperty({ example: 95 })
  imported: number;

  @ApiProperty({ example: 5 })
  skipped: number;

  @ApiProperty({ example: 0 })
  failed: number;

  @ApiPropertyOptional({ type: [String] })
  errors?: string[];
}

export class ContactQueryDto {
  @ApiPropertyOptional({ example: 'john', description: 'Search by name or phone' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'customer', description: 'Filter by tag' })
  @IsString()
  @IsOptional()
  tag?: string;

  @ApiPropertyOptional({
    example: 'whatsapp',
    enum: ['whatsapp', 'manual', 'import'],
    description: 'Filter by contact source',
  })
  @IsString()
  @IsOptional()
  source?: 'whatsapp' | 'manual' | 'import';

  @ApiPropertyOptional({ example: true, description: 'Filter only WhatsApp verified contacts' })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return value;
  })
  isWaContact?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Filter by active status' })
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

  @ApiPropertyOptional({ example: 20, description: 'Items per page', default: 20 })
  @IsOptional()
  @Transform(({ value }) => Math.min(parseInt(value) || 20, 5000))
  limit?: number;
}
