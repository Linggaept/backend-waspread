import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  Min,
  ArrayMinSize,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateBlastDto {
  @ApiProperty({ example: 'January Promo', description: 'Campaign name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Hello! Check out our new products.',
    description: 'Message content. Required if templateId is not provided.',
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({
    example: 'template-uuid',
    description: 'Template ID to use for message content. If provided, message and imageUrl will be taken from template.',
  })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({
    example: { name: 'John', product: 'Laptop' },
    description: 'Variable values to replace in template message.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      if (value === '') return undefined;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return value;
  })
  variableValues?: Record<string, string>;

  @ApiPropertyOptional({
    example: ['628123456789', '628987654331'],
    description:
      'Target phone numbers. Required if phonesFile is not provided. Can be JSON string in multipart form.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one phone number is required' })
  @IsString({ each: true })
  @Transform(({ value }) => {
    // Handle empty string from multipart form-data
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }
    // Handle comma-separated string from multipart form-data
    if (typeof value === 'string') {
      // Try JSON parse first
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        // If not JSON, try comma-separated
        if (value.includes(',')) {
          return value.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        // Single value
        return value.trim() ? [value.trim()] : undefined;
      }
    }
    return value;
  })
  phoneNumbers?: string[];

  @ApiPropertyOptional({
    example: 'promo',
    description:
      'Contact tag to select recipients from saved contacts. If provided, phoneNumbers will be fetched from contacts module.',
  })
  @IsOptional()
  @IsString()
  contactTag?: string;

  @ApiPropertyOptional({
    example: 3000,
    description: 'Delay between messages in ms',
    default: 3000,
  })
  @IsNumber()
  @IsOptional()
  @Min(1000)
  @Transform(({ value }) => {
    // Handle string from multipart form-data
    if (typeof value === 'string') {
      if (value === '') return undefined;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? undefined : parsed;
    }
    return value;
  })
  delayMs?: number;

  // File fields - these are handled by the file interceptor
  // but we need to allow them in the DTO to pass validation
  @Allow()
  @IsOptional()
  phonesFile?: any;

  @Allow()
  @IsOptional()
  imageFile?: any;
}

export class BlastResponseDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  message: string;
  @ApiProperty()
  status: string;
  @ApiProperty()
  totalRecipients: number;
  @ApiProperty()
  sentCount: number;
  @ApiProperty()
  failedCount: number;
  @ApiProperty()
  pendingCount: number;
  @ApiProperty()
  delayMs: number;
  @ApiPropertyOptional()
  imageUrl?: string;
  @ApiPropertyOptional()
  startedAt?: Date;
  @ApiPropertyOptional()
  completedAt?: Date;
  @ApiProperty()
  createdAt: Date;
}

class BlastMessageDetail {
  @ApiProperty()
  id: string;
  @ApiProperty()
  phoneNumber: string;
  @ApiProperty()
  status: string;
  @ApiPropertyOptional()
  sentAt?: Date;
  @ApiPropertyOptional()
  errorMessage?: string;
}

export class BlastDetailDto extends BlastResponseDto {
  @ApiProperty({ type: [BlastMessageDetail] })
  messages: BlastMessageDetail[];
}

export class BlastQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 1)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: 'Items per page', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 10)
  limit?: number;

  @ApiPropertyOptional({ example: 'promo', description: 'Search by campaign name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ 
    example: 'completed', 
    description: 'Filter by status (pending, processing, completed, cancelled, failed)' 
  })
  @IsOptional()
  @IsString()
  status?: string;
}
