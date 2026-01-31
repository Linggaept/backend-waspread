import { IsString, IsUUID } from 'class-validator';
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
  @IsString()
  fraud_status?: string;

  @ApiPropertyOptional({ description: 'Transaction ID from Midtrans' })
  @IsString()
  transaction_id?: string;

  @ApiPropertyOptional({ description: 'Payment type (credit_card, bank_transfer, etc.)' })
  @IsString()
  payment_type?: string;

  @ApiPropertyOptional({ description: 'Gross amount' })
  @IsString()
  gross_amount?: string;

  @ApiPropertyOptional({ description: 'Signature key' })
  @IsString()
  signature_key?: string;

  @ApiPropertyOptional({ description: 'Status code' })
  @IsString()
  status_code?: string;
}
