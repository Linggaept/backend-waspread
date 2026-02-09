import {
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class BlastReplyDto {
  @ApiProperty({ description: 'Reply ID' })
  id: string;

  @ApiProperty({ description: 'Associated blast ID' })
  blastId: string;

  @ApiPropertyOptional({ description: 'Associated blast message ID' })
  blastMessageId?: string;

  @ApiProperty({ description: 'Sender phone number' })
  phoneNumber: string;

  @ApiProperty({ description: 'Reply message content' })
  messageContent: string;

  @ApiPropertyOptional({ description: 'WhatsApp message ID' })
  whatsappMessageId?: string;

  @ApiPropertyOptional({ description: 'Media URL if reply contains media' })
  mediaUrl?: string;

  @ApiPropertyOptional({
    description: 'Media type: image, video, audio, document',
  })
  mediaType?: string;

  @ApiProperty({ description: 'When the reply was received' })
  receivedAt: Date;

  @ApiProperty({ description: 'Whether the reply has been read' })
  isRead: boolean;

  @ApiPropertyOptional({ description: 'When the reply was marked as read' })
  readAt?: Date;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: Date;
}

export class ReplyQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 20)
  limit?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Filter unread replies only',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    example: '628123456789',
    description: 'Filter by phone number',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class ReplyStatsDto {
  @ApiProperty({ description: 'Total number of replies' })
  totalReplies: number;

  @ApiProperty({ description: 'Number of unread replies' })
  unreadCount: number;

  @ApiProperty({ description: 'Number of replies today' })
  todayCount: number;

  @ApiProperty({ description: 'Number of blasts with replies' })
  blastsWithReplies: number;
}

export class BlastReplyWebSocketDto {
  @ApiProperty({ description: 'Reply ID' })
  id: string;

  @ApiProperty({ description: 'Associated blast ID' })
  blastId: string;

  @ApiPropertyOptional({ description: 'Associated blast message ID' })
  blastMessageId?: string;

  @ApiProperty({ description: 'Sender phone number' })
  phoneNumber: string;

  @ApiProperty({ description: 'Reply message content' })
  messageContent: string;

  @ApiPropertyOptional({ description: 'Media URL if reply contains media' })
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Media type' })
  mediaType?: string;

  @ApiProperty({ description: 'When the reply was received' })
  receivedAt: Date;
}
