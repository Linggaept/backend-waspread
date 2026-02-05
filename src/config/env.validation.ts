import { plainToInstance } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  validateSync,
  Min,
  IsEmail,
} from 'class-validator';

export class EnvironmentVariables {
  // Database
  @IsString()
  DB_HOST: string;

  @IsNumber()
  @Min(1)
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  // Redis
  @IsString()
  REDIS_HOST: string;

  @IsNumber()
  @Min(1)
  REDIS_PORT: number;

  // JWT
  @IsString()
  JWT_SECRET: string;

  @IsNumber()
  @IsOptional()
  JWT_EXPIRES_IN?: number;

  // App
  @IsNumber()
  @IsOptional()
  APP_PORT?: number;

  @IsString()
  @IsOptional()
  NODE_ENV?: string;

  // Midtrans
  @IsString()
  MIDTRANS_SERVER_KEY: string;

  @IsString()
  MIDTRANS_CLIENT_KEY: string;

  @IsBoolean()
  @IsOptional()
  MIDTRANS_IS_PRODUCTION?: boolean;

  // Cloudflare R2 (Optional)
  @IsString()
  @IsOptional()
  R2_ACCOUNT_ID?: string;

  @IsString()
  @IsOptional()
  R2_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  R2_SECRET_ACCESS_KEY?: string;

  @IsString()
  @IsOptional()
  R2_BUCKET_NAME?: string;

  @IsString()
  @IsOptional()
  R2_PUBLIC_URL?: string;

  // Mail
  @IsString()
  MAIL_HOST: string;

  @IsNumber()
  MAIL_PORT: number;

  @IsString()
  MAIL_USER: string;

  @IsString()
  MAIL_PASS: string;

  @IsString()
  @IsOptional()
  MAIL_FROM?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map((err) => {
      const constraints = Object.values(err.constraints || {}).join(', ');
      return `${err.property}: ${constraints}`;
    });
    throw new Error(
      `\n❌ Environment validation failed:\n  - ${errorMessages.join('\n  - ')}\n`,
    );
  }

  return validatedConfig;
}
