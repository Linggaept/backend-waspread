import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FunnelStage } from '../../../database/entities/conversation-funnel.entity';

export class UpdateFunnelStageDto {
  @ApiProperty({
    description: 'New funnel stage',
    enum: FunnelStage,
    example: 'closed_won',
  })
  @IsEnum(FunnelStage)
  @IsNotEmpty()
  stage: FunnelStage;

  @ApiPropertyOptional({
    description: 'Deal value (for closed_won)',
    example: 2500000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dealValue?: number;

  @ApiPropertyOptional({
    description: 'Reason for closing',
    example: 'Customer transferred via BCA',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateFunnelEntryDto {
  @ApiProperty({
    description: 'Phone number',
    example: '628123456789',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiPropertyOptional({
    description: 'Blast ID if originated from blast',
  })
  @IsOptional()
  @IsString()
  blastId?: string;

  @ApiPropertyOptional({
    description: 'Blast name',
  })
  @IsOptional()
  @IsString()
  blastName?: string;

  @ApiPropertyOptional({
    description: 'Initial stage',
    enum: FunnelStage,
    default: FunnelStage.BLAST_SENT,
  })
  @IsOptional()
  @IsEnum(FunnelStage)
  stage?: FunnelStage;
}

export class FunnelStageResponse {
  stage: FunnelStage;
  count: number;
  percentage: number;
  dropOff?: number;
}

export class FunnelOverviewResponse {
  period: string;
  blastId?: string;
  blastName?: string;
  funnel: FunnelStageResponse[];
  avgTimeToClose: string;
  bottleneck: string;
  totalRevenue: number;
  conversionRate: number;
}
