import { IsEnum, IsOptional, IsBoolean, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ThemeMode } from '../../../database/entities/user-settings.entity';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    enum: ThemeMode,
    description: 'Theme mode: light, dark, or system',
    example: 'dark',
  })
  @IsOptional()
  @IsEnum(ThemeMode)
  theme?: ThemeMode;

  @ApiPropertyOptional({
    description: 'Enable notification sound',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notificationSound?: boolean;

  @ApiPropertyOptional({
    description: 'Enable desktop notifications',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notificationDesktop?: boolean;

  @ApiPropertyOptional({
    description: 'Preferred language (e.g. id, en)',
    example: 'id',
  })
  @IsOptional()
  @IsString()
  language?: string;
}
