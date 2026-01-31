import { IsString, IsUUID } from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  packageId: string;
}

export class MidtransNotificationDto {
  @IsString()
  order_id: string;

  @IsString()
  transaction_status: string;

  @IsString()
  fraud_status?: string;

  @IsString()
  transaction_id?: string;

  @IsString()
  payment_type?: string;

  @IsString()
  gross_amount?: string;

  @IsString()
  signature_key?: string;

  @IsString()
  status_code?: string;
}
