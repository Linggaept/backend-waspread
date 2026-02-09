import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description:
      'Search by phone number, message body, contact name, or pushName',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ChatHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class ChatSendMessageDto {
  @ApiProperty({ description: 'Recipient phone number (e.g. 628123456789)' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ description: 'Message text' })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class DeleteMessageDto {
  @ApiProperty({ description: 'Message ID to delete' })
  @IsString()
  @IsNotEmpty()
  messageId: string;
}

export class RetractMessageDto {
  @ApiProperty({ description: 'Message ID to retract (delete for everyone)' })
  @IsString()
  @IsNotEmpty()
  messageId: string;
}
