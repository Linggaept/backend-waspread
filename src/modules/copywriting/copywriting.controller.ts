import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CopywritingService } from './copywriting.service';
import { GenerateCopyDto, GenerateCopyResponseDto } from './dto';
import { JwtAuthGuard, FeatureGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeature } from '../auth/decorators/feature.decorator';
import { AiTokenService } from '../ai/services/ai-token.service';
import { AiFeatureType } from '../../database/entities/ai-token-usage.entity';

@ApiTags('Copywriting')
@ApiBearerAuth('JWT-auth')
@Controller('copywriting')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('ai')
export class CopywritingController {
  constructor(
    private readonly copywritingService: CopywritingService,
    private readonly aiTokenService: AiTokenService,
  ) {}

  @Post('generate')
  @ApiOperation({
    summary: 'Generate WhatsApp marketing copy with AI',
    description:
      'Uses Google Gemini to generate persuasive WhatsApp marketing messages with multiple variations. Token cost is dynamic based on actual usage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generated copywriting variations',
    type: GenerateCopyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Gemini not configured, generation failed, or insufficient tokens',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'AI feature not available or insufficient tokens',
  })
  async generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateCopyDto,
  ): Promise<GenerateCopyResponseDto & { tokensUsed: number }> {
    // Check token balance first (minimum ~30 tokens for copywriting)
    const minTokensRequired = 30;
    const balance = await this.aiTokenService.checkBalance(
      userId,
      minTokensRequired,
    );
    if (!balance.hasEnough) {
      throw new BadRequestException(
        `Insufficient AI tokens. Required: ~${minTokensRequired}, Available: ${balance.balance}`,
      );
    }

    const result = await this.copywritingService.generateCopy(dto);

    // Use tokens based on actual Gemini usage (dynamic pricing)
    if (result.tokenUsage.platformTokens > 0) {
      await this.aiTokenService.useTokens(
        userId,
        AiFeatureType.COPYWRITING,
        result.tokenUsage.platformTokens,
      );
    }

    return {
      variations: result.variations,
      prompt: result.prompt,
      tone: result.tone,
      tokensUsed: result.tokenUsage.platformTokens,
    };
  }
}
