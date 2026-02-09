import { IsOptional, IsNumber, IsEnum, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../../../database/entities/notification.entity';

export class NotificationQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: 'Items per page' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    example: 'false',
    description: 'Filter by read status',
  })
  @IsOptional()
  @IsString()
  isRead?: string;

  @ApiPropertyOptional({
    enum: NotificationType,
    description: 'Filter by notification type',
  })
  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;
}
