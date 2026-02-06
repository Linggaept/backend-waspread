import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnalyticsService } from './services/analytics.service';
import { FunnelTrackerService } from './services/funnel-tracker.service';
import { ClosingInsightService } from './services/closing-insight.service';
import {
  AnalyticsQueryDto,
  FunnelQueryDto,
  UnrepliedQueryDto,
  ConversationListQueryDto,
  UpdateFunnelStageDto,
} from './dto';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly funnelTrackerService: FunnelTrackerService,
    private readonly closingInsightService: ClosingInsightService,
  ) {}

  // ==================== Overview ====================

  @Get('overview')
  @ApiOperation({ summary: 'Get analytics dashboard overview' })
  @ApiResponse({ status: 200, description: 'Overview retrieved successfully' })
  async getOverview(
    @CurrentUser('id') userId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOverview(userId, query);
  }

  // ==================== Funnel ====================

  @Get('funnel')
  @ApiOperation({ summary: 'Get conversion funnel analytics' })
  @ApiResponse({ status: 200, description: 'Funnel data retrieved successfully' })
  async getFunnel(
    @CurrentUser('id') userId: string,
    @Query() query: FunnelQueryDto,
  ) {
    return this.analyticsService.getFunnelAnalytics(userId, query);
  }

  @Get('funnel/conversations')
  @ApiOperation({ summary: 'List conversations with funnel stages' })
  @ApiResponse({ status: 200, description: 'Conversation list retrieved' })
  async getConversationList(
    @CurrentUser('id') userId: string,
    @Query() query: ConversationListQueryDto,
  ) {
    return this.analyticsService.getConversationList(userId, query);
  }

  @Get('funnel/:phoneNumber')
  @ApiOperation({ summary: 'Get funnel detail for a phone number' })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number (e.g., 628123456789)' })
  @ApiResponse({ status: 200, description: 'Funnel detail retrieved' })
  @ApiResponse({ status: 404, description: 'Funnel not found' })
  async getFunnelDetail(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    const funnel = await this.funnelTrackerService.getFunnel(userId, phoneNumber);
    if (!funnel) {
      throw new NotFoundException(`No funnel found for ${phoneNumber}`);
    }
    return funnel;
  }

  @Put('funnel/:phoneNumber/stage')
  @ApiOperation({ summary: 'Manually update funnel stage' })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number (e.g., 628123456789)' })
  @ApiResponse({ status: 200, description: 'Stage updated successfully' })
  async updateFunnelStage(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Body() dto: UpdateFunnelStageDto,
  ) {
    const funnel = await this.funnelTrackerService.updateStageManual(
      userId,
      phoneNumber,
      dto.stage,
      { dealValue: dto.dealValue, reason: dto.reason },
    );

    // Trigger AI analysis if closing
    if (dto.stage === 'closed_won' || dto.stage === 'closed_lost') {
      // Fire and forget - don't wait for AI
      this.closingInsightService
        .analyzeClosing(userId, phoneNumber)
        .catch((err) => {
          console.error(`AI analysis failed: ${err}`);
        });
    }

    return funnel;
  }

  // ==================== Unreplied ====================

  @Get('unreplied')
  @ApiOperation({ summary: 'Get unreplied conversations (needs attention)' })
  @ApiResponse({ status: 200, description: 'Unreplied list retrieved' })
  async getUnreplied(
    @CurrentUser('id') userId: string,
    @Query() query: UnrepliedQueryDto,
  ) {
    return this.analyticsService.getUnrepliedConversations(userId, query);
  }

  // ==================== Blast Performance ====================

  @Get('blast/:blastId')
  @ApiOperation({ summary: 'Get performance analytics for a specific blast' })
  @ApiParam({ name: 'blastId', description: 'Blast campaign ID' })
  @ApiResponse({ status: 200, description: 'Blast performance retrieved' })
  @ApiResponse({ status: 404, description: 'Blast not found' })
  async getBlastPerformance(
    @CurrentUser('id') userId: string,
    @Param('blastId') blastId: string,
  ) {
    const performance = await this.analyticsService.getBlastPerformance(
      userId,
      blastId,
    );

    if (!performance) {
      throw new NotFoundException('Blast not found');
    }

    return performance;
  }

  // ==================== Trends ====================

  @Get('trends')
  @ApiOperation({ summary: 'Get analytics trends over time' })
  @ApiResponse({ status: 200, description: 'Trends retrieved successfully' })
  async getTrends(
    @CurrentUser('id') userId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTrends(userId, query);
  }

  // ==================== AI Insights ====================

  @Get('insights/patterns')
  @ApiOperation({ summary: 'Get aggregate patterns from all analyzed conversations' })
  @ApiResponse({ status: 200, description: 'Patterns retrieved' })
  async getPatterns(
    @CurrentUser('id') userId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const dateRange = this.getDateRange(query);
    return this.closingInsightService.getPatterns(userId, dateRange);
  }

  @Get('insights/:phoneNumber')
  @ApiOperation({ summary: 'Get AI insight for a conversation' })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number (e.g., 628123456789)' })
  @ApiResponse({ status: 200, description: 'Insight retrieved' })
  @ApiResponse({ status: 404, description: 'No insight available' })
  async getInsight(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    const insight = await this.closingInsightService.getInsight(
      userId,
      phoneNumber,
    );

    if (!insight) {
      throw new NotFoundException('No AI insight available for this conversation');
    }

    return insight;
  }

  @Post('insights/:phoneNumber/analyze')
  @ApiOperation({ summary: 'Force AI analysis for a conversation' })
  @ApiParam({ name: 'phoneNumber', description: 'Phone number (e.g., 628123456789)' })
  @ApiResponse({ status: 201, description: 'Analysis completed' })
  async analyzeConversation(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    return this.closingInsightService.reanalyze(userId, phoneNumber);
  }

  // ==================== Helper ====================

  private getDateRange(query: AnalyticsQueryDto): { startDate: Date; endDate: Date } {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (query.period) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        endDate = new Date();
        break;
      case '7d':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case 'custom':
        startDate = query.startDate
          ? new Date(query.startDate)
          : new Date(now.setDate(now.getDate() - 30));
        endDate = query.endDate ? new Date(query.endDate) : new Date();
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }

    return { startDate, endDate };
  }
}
