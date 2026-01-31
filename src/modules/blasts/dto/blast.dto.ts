import { IsString, IsArray, IsOptional, IsNumber, Min, ArrayMinSize } from 'class-validator';

export class CreateBlastDto {
  @IsString()
  name: string;

  @IsString()
  message: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  phoneNumbers: string[];

  @IsNumber()
  @IsOptional()
  @Min(1000)
  delayMs?: number;
}

export class BlastResponseDto {
  id: string;
  name: string;
  message: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  delayMs: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export class BlastDetailDto extends BlastResponseDto {
  messages: {
    id: string;
    phoneNumber: string;
    status: string;
    sentAt?: Date;
    errorMessage?: string;
  }[];
}
