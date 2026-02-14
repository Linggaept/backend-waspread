import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../auth/guards';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { AiTokenPricingService } from '../services/ai-token-pricing.service';
import {
  CreateTokenPricingDto,
  UpdateTokenPricingDto,
} from '../dto/ai-token-pricing.dto';

@ApiTags('AI Token Pricing')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('ai/pricing')
export class AiTokenPricingController {
  constructor(
    private readonly pricingService: AiTokenPricingService,
  ) {}

  @Get()
  @ApiOperation({ summary: '[Admin] Get all token pricing configs' })
  @ApiResponse({
    status: 200,
    description: 'List of pricing configs',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string', example: 'default' },
          divisor: { type: 'number', example: 200 },
          markup: { type: 'number', example: 1.0 },
          minTokens: { type: 'number', example: 1 },
          isActive: { type: 'boolean' },
          description: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  findAll() {
    return this.pricingService.findAll();
  }

  @Get('summary')
  @ApiOperation({
    summary: '[Admin] Get pricing summary with examples',
    description:
      'Returns current pricing config with example calculations showing Gemini tokens → Platform tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Pricing summary',
    schema: {
      type: 'object',
      properties: {
        default: {
          type: 'object',
          properties: {
            divisor: { type: 'number', example: 200 },
            markup: { type: 'number', example: 1.0 },
            minTokens: { type: 'number', example: 1 },
          },
        },
        features: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              divisor: { type: 'number' },
              markup: { type: 'number' },
              minTokens: { type: 'number' },
            },
          },
        },
        examples: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              geminiTokens: { type: 'number' },
              platformTokens: { type: 'number' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  })
  getSummary() {
    return this.pricingService.getPricingSummary();
  }

  @Get(':id')
  @ApiOperation({ summary: '[Admin] Get pricing config by ID' })
  @ApiResponse({ status: 200, description: 'Pricing config' })
  @ApiResponse({ status: 404, description: 'Pricing config not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricingService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: '[Admin] Create new pricing config',
    description: `Create a feature-specific pricing config.

**Formula:** platformTokens = ceil(geminiTokens / divisor) * markup

**Example with default values (divisor=200, markup=1.0):**
- 1000 Gemini tokens = ceil(1000/200) * 1.0 = 5 platform tokens
- 2500 Gemini tokens = ceil(2500/200) * 1.0 = 13 platform tokens`,
  })
  @ApiResponse({ status: 201, description: 'Pricing config created' })
  @ApiResponse({ status: 400, description: 'Key already exists' })
  async create(@Body() dto: CreateTokenPricingDto) {
    // Check if key already exists
    const existing = await this.pricingService.findByKey(dto.key);
    if (existing) {
      throw new BadRequestException(`Pricing key '${dto.key}' already exists`);
    }
    return this.pricingService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '[Admin] Update pricing config' })
  @ApiResponse({ status: 200, description: 'Pricing config updated' })
  @ApiResponse({ status: 404, description: 'Pricing config not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTokenPricingDto,
  ) {
    return this.pricingService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[Admin] Delete pricing config',
    description: 'Cannot delete the "default" pricing config',
  })
  @ApiResponse({ status: 200, description: 'Pricing config deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete default pricing' })
  @ApiResponse({ status: 404, description: 'Pricing config not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.pricingService.delete(id);
    return { message: 'Pricing config deleted' };
  }
}
