import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../auth/guards';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { AiTokenService } from '../services/ai-token.service';
import {
  PurchaseTokenDto,
  CreateTokenPackageDto,
  UpdateTokenPackageDto,
  TokenUsageQueryDto,
  AdminAddTokensDto,
} from '../dto/ai-token.dto';

@ApiTags('AI Tokens')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('ai/tokens')
export class AiTokenController {
  constructor(private readonly aiTokenService: AiTokenService) {}

  // ==================== User Endpoints ====================

  @Get('balance')
  @ApiOperation({ summary: 'Get current AI token balance' })
  @ApiResponse({
    status: 200,
    description: 'Token balance info',
    schema: {
      type: 'object',
      properties: {
        balance: { type: 'number', example: 150 },
        totalPurchased: { type: 'number', example: 200 },
        totalUsed: { type: 'number', example: 50 },
      },
    },
  })
  getBalance(@CurrentUser('id') userId: string) {
    return this.aiTokenService.getBalance(userId);
  }

  @Get('feature-costs')
  @ApiOperation({
    summary: 'Get token cost per AI feature',
    description: 'Returns the token cost for each AI feature',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature token costs',
    schema: {
      type: 'object',
      properties: {
        suggest: { type: 'number', example: 1 },
        auto_reply: { type: 'number', example: 1 },
        copywriting: { type: 'number', example: 2 },
        knowledge_import: { type: 'number', example: 5 },
      },
    },
  })
  getFeatureCosts() {
    return this.aiTokenService.getAllFeatureTokenCosts();
  }

  @Get('packages')
  @ApiOperation({ summary: 'Get available token packages' })
  @ApiResponse({
    status: 200,
    description: 'List of token packages',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: '100 Token' },
          description: { type: 'string' },
          tokenAmount: { type: 'number', example: 100 },
          bonusTokens: { type: 'number', example: 10 },
          price: { type: 'number', example: 45000 },
          isPopular: { type: 'boolean' },
        },
      },
    },
  })
  getPackages() {
    return this.aiTokenService.getPackages();
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'Get token package details' })
  getPackage(@Param('id', ParseUUIDPipe) id: string) {
    return this.aiTokenService.getPackage(id);
  }

  @Post('purchase')
  @ApiOperation({
    summary: 'Initiate token purchase',
    description: 'Creates a pending purchase record. Use with payment flow.',
  })
  @ApiResponse({ status: 201, description: 'Purchase initiated' })
  async purchaseTokens(
    @CurrentUser('id') userId: string,
    @Body() dto: PurchaseTokenDto,
  ) {
    const purchase = await this.aiTokenService.createPurchase(
      userId,
      dto.packageId,
    );
    return {
      purchaseId: purchase.id,
      tokenAmount: purchase.tokenAmount,
      price: purchase.price,
      status: purchase.status,
    };
  }

  @Get('purchases')
  @ApiOperation({ summary: 'Get token purchase history' })
  @ApiResponse({ status: 200, description: 'Purchase history' })
  getPurchaseHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.aiTokenService.getPurchaseHistory(userId, page, limit);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get token usage history' })
  @ApiResponse({ status: 200, description: 'Usage history' })
  getUsageHistory(
    @CurrentUser('id') userId: string,
    @Query() query: TokenUsageQueryDto,
  ) {
    return this.aiTokenService.getUsageHistory(
      userId,
      query.page,
      query.limit,
      query.feature,
    );
  }

  @Get('usage/stats')
  @ApiOperation({ summary: 'Get token usage statistics' })
  @ApiResponse({
    status: 200,
    description: 'Usage statistics',
    schema: {
      type: 'object',
      properties: {
        today: { type: 'number', example: 5 },
        thisWeek: { type: 'number', example: 25 },
        thisMonth: { type: 'number', example: 80 },
        byFeature: {
          type: 'object',
          example: {
            auto_reply: 40,
            suggest: 30,
            copywriting: 10,
          },
        },
      },
    },
  })
  getUsageStats(@CurrentUser('id') userId: string) {
    return this.aiTokenService.getUsageStats(userId);
  }

  // ==================== Admin Endpoints ====================

  @Post('packages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Create token package' })
  @ApiResponse({ status: 201, description: 'Package created' })
  createPackage(@Body() dto: CreateTokenPackageDto) {
    return this.aiTokenService.createPackage(dto);
  }

  @Put('packages/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Update token package' })
  @ApiResponse({ status: 200, description: 'Package updated' })
  updatePackage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTokenPackageDto,
  ) {
    return this.aiTokenService.updatePackage(id, dto);
  }

  @Delete('packages/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Delete token package' })
  @ApiResponse({ status: 200, description: 'Package deleted' })
  async deletePackage(@Param('id', ParseUUIDPipe) id: string) {
    await this.aiTokenService.deletePackage(id);
    return { message: 'Package deleted' };
  }

  @Post('admin/add')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Add tokens to user (bonus/promo)' })
  @ApiResponse({ status: 200, description: 'Tokens added' })
  adminAddTokens(@Body() dto: AdminAddTokensDto) {
    return this.aiTokenService.addTokens(dto.userId, dto.amount, dto.reason);
  }
}
