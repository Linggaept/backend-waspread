import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../../../database/entities/payment.entity';

export enum PaymentSortBy {
  CREATED_AT = 'createdAt',
  AMOUNT = 'amount',
  STATUS = 'status',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class PaymentQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @ApiPropertyOptional({
    enum: PaymentSortBy,
    default: PaymentSortBy.CREATED_AT,
  })
  @IsEnum(PaymentSortBy)
  @IsOptional()
  sortBy?: PaymentSortBy = PaymentSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;
}
