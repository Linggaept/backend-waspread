import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum CopywritingTone {
  FRIENDLY = 'friendly',
  URGENT = 'urgent',
  PROFESSIONAL = 'professional',
  CASUAL = 'casual',
  EXCITED = 'excited',
}

export class GenerateCopyDto {
  @ApiProperty({
    description: 'Marketing prompt / product description',
    example: 'Diskon 50% sepatu lari Nike, besok terakhir',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  prompt: string;

  @ApiPropertyOptional({
    description: 'Number of message variations to generate',
    example: 3,
    default: 3,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  variations?: number = 3;

  @ApiPropertyOptional({
    description: 'Tone of the generated message',
    enum: CopywritingTone,
    default: CopywritingTone.FRIENDLY,
  })
  @IsOptional()
  @IsEnum(CopywritingTone)
  tone?: CopywritingTone = CopywritingTone.FRIENDLY;

  @ApiPropertyOptional({
    description: 'Whether to include emojis in generated messages',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeEmojis?: boolean = true;

  @ApiPropertyOptional({
    description: 'Language code for generated messages',
    example: 'id',
    default: 'id',
  })
  @IsOptional()
  @IsString()
  language?: string = 'id';
}

export class CopyVariationDto {
  @ApiProperty({ description: 'Generated message content' })
  message: string;

  @ApiProperty({ description: 'Character count of the message' })
  characterCount: number;
}

export class GenerateCopyResponseDto {
  @ApiProperty({
    description: 'Generated message variations',
    type: [CopyVariationDto],
  })
  variations: CopyVariationDto[];

  @ApiProperty({ description: 'Original prompt used' })
  prompt: string;

  @ApiProperty({
    description: 'Tone used for generation',
    enum: CopywritingTone,
  })
  tone: CopywritingTone;
}
