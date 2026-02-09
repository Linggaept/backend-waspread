import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReplyTone } from '../../../database/entities/ai-settings.entity';

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: 'Enable/disable AI suggestions' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: 'Toko Sukses Jaya' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({
    example: 'Kami menjual pakaian import berkualitas dengan harga terjangkau.',
  })
  @IsOptional()
  @IsString()
  businessDescription?: string;

  @ApiPropertyOptional({
    enum: ReplyTone,
    example: 'friendly',
    description: 'Tone of AI replies: formal, casual, or friendly',
  })
  @IsOptional()
  @IsEnum(ReplyTone)
  replyTone?: ReplyTone;
}
