import { IsString, IsArray, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionStatusDto {
  @ApiProperty()
  userId: string;
  @ApiProperty()
  status: string;
  @ApiPropertyOptional()
  phoneNumber?: string;
  @ApiPropertyOptional()
  pushName?: string;
  @ApiPropertyOptional()
  qrCode?: string;
  @ApiPropertyOptional()
  lastConnectedAt?: Date;
  @ApiPropertyOptional()
  lastDisconnectedAt?: Date;
  @ApiPropertyOptional()
  disconnectReason?: string;
}

export class SendMessageDto {
  @ApiProperty({
    example: '628123456789',
    description: 'Destination phone number',
  })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 'Hello World!', description: 'Message content' })
  @IsString()
  message: string;
}

export class SendBulkMessageDto {
  @ApiProperty({
    example: ['628123456789', '628987654331'],
    description: 'List of phone numbers',
  })
  @IsArray()
  @IsString({ each: true })
  phoneNumbers: string[];

  @ApiProperty({ example: 'Hello everyone!', description: 'Message content' })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Delay in ms between messages',
  })
  @IsNumber()
  @IsOptional()
  delayMs?: number;
}
