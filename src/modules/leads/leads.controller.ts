import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard, FeatureGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeature } from '../auth/decorators/feature.decorator';
import { LeadsService } from './leads.service';
import { UpdateLeadScoreSettingsDto } from './dto/settings.dto';
import {
  LeadQueryDto,
  ManualScoreOverrideDto,
  BulkScoreOverrideDto,
  RecalculateDto,
} from './dto/lead.dto';

@ApiTags('Leads')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('leadScoring')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // ==================== Settings ====================

  @Get('settings')
  @ApiOperation({ summary: 'Get lead scoring settings' })
  @ApiResponse({ status: 200, description: 'Settings retrieved successfully' })
  async getSettings(@CurrentUser('id') userId: string) {
    return this.leadsService.getSettings(userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update lead scoring settings' })
  @ApiResponse({ status: 200, description: 'Settings updated successfully' })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLeadScoreSettingsDto,
  ) {
    return this.leadsService.updateSettings(userId, dto);
  }

  // ==================== Leads List & Stats ====================

  @Get()
  @ApiOperation({ summary: 'List leads with scores (paginated, filterable)' })
  @ApiResponse({ status: 200, description: 'Leads retrieved successfully' })
  async getLeads(
    @CurrentUser('id') userId: string,
    @Query() query: LeadQueryDto,
  ) {
    return this.leadsService.getLeads(userId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lead statistics (total hot/warm/cold)' })
  @ApiResponse({
    status: 200,
    description: 'Stats retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', example: 150 },
        hot: { type: 'number', example: 25 },
        warm: { type: 'number', example: 60 },
        cold: { type: 'number', example: 65 },
      },
    },
  })
  async getStats(@CurrentUser('id') userId: string) {
    return this.leadsService.getStats(userId);
  }

  @Get(':phoneNumber')
  @ApiOperation({ summary: 'Get lead detail with score breakdown' })
  @ApiResponse({ status: 200, description: 'Lead retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLeadDetail(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    return this.leadsService.getLeadDetail(userId, phoneNumber);
  }

  // ==================== Manual Override ====================

  @Put(':phoneNumber/override')
  @ApiOperation({ summary: 'Manual override lead score' })
  @ApiResponse({ status: 200, description: 'Score overridden successfully' })
  async overrideScore(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Body() dto: ManualScoreOverrideDto,
  ) {
    return this.leadsService.overrideScore(userId, phoneNumber, dto);
  }

  @Delete(':phoneNumber/override')
  @ApiOperation({
    summary: 'Remove manual override and recalculate score',
  })
  @ApiResponse({ status: 200, description: 'Override removed successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async removeOverride(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    return this.leadsService.removeOverride(userId, phoneNumber);
  }

  @Post('bulk-override')
  @ApiOperation({ summary: 'Bulk override multiple lead scores' })
  @ApiResponse({
    status: 201,
    description: 'Bulk override completed',
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              phoneNumber: { type: 'string' },
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async bulkOverride(
    @CurrentUser('id') userId: string,
    @Body() dto: BulkScoreOverrideDto,
  ) {
    return this.leadsService.bulkOverride(userId, dto);
  }

  // ==================== Recalculation ====================

  @Post('recalculate')
  @ApiOperation({
    summary: 'Force recalculate lead scores',
    description:
      'Recalculates scores for specified phone numbers, or all leads if none specified',
  })
  @ApiResponse({
    status: 201,
    description: 'Recalculation completed',
    schema: {
      type: 'object',
      properties: {
        enqueued: { type: 'number', example: 50 },
        total: { type: 'number', example: 50 },
      },
    },
  })
  async recalculate(
    @CurrentUser('id') userId: string,
    @Body() dto: RecalculateDto,
  ) {
    return this.leadsService.recalculate(userId, dto);
  }
}
