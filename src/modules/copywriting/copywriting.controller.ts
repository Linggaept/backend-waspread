import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CopywritingService } from './copywriting.service';
import { GenerateCopyDto, GenerateCopyResponseDto } from './dto';
import { JwtAuthGuard, FeatureGuard, AiQuotaGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeature } from '../auth/decorators/feature.decorator';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@ApiTags('Copywriting')
@ApiBearerAuth('JWT-auth')
@Controller('copywriting')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('ai')
export class CopywritingController {
  constructor(
    private readonly copywritingService: CopywritingService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post('generate')
  @UseGuards(AiQuotaGuard)
  @ApiOperation({
    summary: 'Generate WhatsApp marketing copy with AI',
    description:
      'Uses Google Gemini to generate persuasive WhatsApp marketing messages with multiple variations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generated copywriting variations',
    type: GenerateCopyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Gemini not configured or generation failed',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'AI feature not available or quota exceeded',
  })
  async generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateCopyDto,
  ): Promise<GenerateCopyResponseDto> {
    const result = await this.copywritingService.generateCopy(dto);
    // Use 1 AI quota per generation
    await this.subscriptionsService.useAiQuota(userId, 1);
    return result;
  }
}
