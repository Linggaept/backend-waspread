import { IsString, IsUUID, IsOptional, Allow } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ description: 'UUID of the subscription package' })
  @IsUUID()
  packageId: string;
}

export class MidtransNotificationDto {
  @ApiProperty({ description: 'Order ID' })
  @IsString()
  order_id: string;

  @ApiProperty({ description: 'Transaction status (capture, settlement, pending, deny, expire, cancel)' })
  @IsString()
  transaction_status: string;

  @ApiPropertyOptional({ description: 'Fraud status (accept, challenge, deny)' })
  @IsOptional()
  @IsString()
  fraud_status?: string;

  @ApiPropertyOptional({ description: 'Transaction ID from Midtrans' })
  @IsOptional()
  @IsString()
  transaction_id?: string;

  @ApiPropertyOptional({ description: 'Payment type (credit_card, bank_transfer, etc.)' })
  @IsOptional()
  @IsString()
  payment_type?: string;

  @ApiPropertyOptional({ description: 'Gross amount' })
  @IsOptional()
  @IsString()
  gross_amount?: string;

  @ApiPropertyOptional({ description: 'Signature key' })
  @IsOptional()
  @IsString()
  signature_key?: string;

  @ApiPropertyOptional({ description: 'Status code' })
  @IsOptional()
  @IsString()
  status_code?: string;

  // Additional fields from Midtrans that may be present
  @Allow()
  transaction_time?: string;

  @Allow()
  status_message?: string;

  @Allow()
  settlement_time?: string;

  @Allow()
  merchant_id?: string;

  @Allow()
  currency?: string;
}
