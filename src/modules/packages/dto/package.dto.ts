import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';

export class CreatePackageDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  durationDays?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  monthlyQuota?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  dailyLimit?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class UpdatePackageDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  durationDays?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  monthlyQuota?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  dailyLimit?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
