import { IsString, IsArray, IsOptional, IsNumber, Min, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBlastDto {
  @ApiProperty({ example: 'January Promo', description: 'Campaign name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Hello! Check out our new products.', description: 'Message content' })
  @IsString()
  message: string;

  @ApiProperty({ example: ['628123456789', '628987654321'], description: 'Target phone numbers' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  phoneNumbers: string[];

  @ApiPropertyOptional({ example: 3000, description: 'Delay between messages in ms', default: 3000 })
  @IsNumber()
  @IsOptional()
  @Min(1000)
  delayMs?: number;
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
