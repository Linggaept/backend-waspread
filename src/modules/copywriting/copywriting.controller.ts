import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CopywritingService } from './copywriting.service';
import { GenerateCopyDto, GenerateCopyResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Copywriting')
@ApiBearerAuth('JWT-auth')
@Controller('copywriting')
@UseGuards(JwtAuthGuard)
export class CopywritingController {
  constructor(private readonly copywritingService: CopywritingService) {}

  @Post('generate')
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
  generate(@Body() dto: GenerateCopyDto): Promise<GenerateCopyResponseDto> {
    return this.copywritingService.generateCopy(dto);
  }
}
