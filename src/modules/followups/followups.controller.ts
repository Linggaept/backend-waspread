import {
  Controller,
  Get,
  Post,
  Patch,
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
import { FollowupsService } from './followups.service';
import {
  CreateFollowupDto,
  UpdateFollowupDto,
  FollowupQueryDto,
  FollowupMessageQueryDto,
  FollowupCampaignResponseDto,
  FollowupMessageResponseDto,
  FollowupStatsDto,
  CreateContactFollowupDto,
} from './dto';
import { ContactFollowupService } from './services/contact-followup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Followups')
@ApiBearerAuth('JWT-auth')
@Controller('followups')
@UseGuards(JwtAuthGuard)
export class FollowupsController {
  constructor(
    private readonly followupsService: FollowupsService,
    private readonly contactFollowupService: ContactFollowupService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create follow-up campaign',
    description:
      'Create a new follow-up campaign linked to an existing blast. The blast must be completed.',
  })
  @ApiResponse({
    status: 201,
    description: 'Follow-up campaign created successfully',
    type: FollowupCampaignResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or blast not completed',
  })
  @ApiResponse({
    status: 404,
    description: 'Original blast not found',
  })
  async create(
    @CurrentUser('id') userId: string,
    @Body() createFollowupDto: CreateFollowupDto,
  ) {
    return this.followupsService.create(userId, createFollowupDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List follow-up campaigns',
    description: 'Get all follow-up campaigns for the current user with pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of follow-up campaigns',
  })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: FollowupQueryDto,
  ) {
    const { data, total } = await this.followupsService.findAll(userId, query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get follow-up statistics',
    description: 'Get aggregated statistics for all follow-up campaigns',
  })
  @ApiResponse({
    status: 200,
    description: 'Follow-up statistics',
    type: FollowupStatsDto,
  })
  async getStats(@CurrentUser('id') userId: string) {
    return this.followupsService.getStats(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get follow-up campaign details',
    description: 'Get detailed information about a specific follow-up campaign',
  })
  @ApiResponse({
    status: 200,
    description: 'Follow-up campaign details',
    type: FollowupCampaignResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Follow-up campaign not found',
  })
  async findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followupsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update follow-up campaign',
    description:
      'Update a follow-up campaign. Can be used to pause/resume, update messages, etc.',
  })
  @ApiResponse({
    status: 200,
    description: 'Follow-up campaign updated',
    type: FollowupCampaignResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Follow-up campaign not found',
  })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFollowupDto: UpdateFollowupDto,
  ) {
    return this.followupsService.update(userId, id, updateFollowupDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete follow-up campaign',
    description:
      'Delete a follow-up campaign. All scheduled messages will be cancelled.',
  })
  @ApiResponse({
    status: 200,
    description: 'Follow-up campaign deleted',
  })
  @ApiResponse({
    status: 404,
    description: 'Follow-up campaign not found',
  })
  async delete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.followupsService.delete(userId, id);
    return { message: 'Follow-up campaign deleted successfully' };
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Get follow-up messages',
    description:
      'Get all follow-up messages for a campaign with pagination and filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of follow-up messages',
  })
  @ApiResponse({
    status: 404,
    description: 'Follow-up campaign not found',
  })
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FollowupMessageQueryDto,
  ) {
    const { data, total } = await this.followupsService.getMessages(
      userId,
      id,
      query,
    );
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 20,
      totalPages: Math.ceil(total / (query.limit || 20)),
    };
  }

  @Post(':id/schedule')
  @ApiOperation({
    summary: 'Manually trigger scheduling',
    description:
      'Manually trigger the scheduling of follow-up messages for eligible recipients. This is normally done automatically by the scheduler.',
  })
  @ApiResponse({
    status: 200,
    description: 'Scheduling triggered',
  })
  @ApiResponse({
    status: 404,
    description: 'Follow-up campaign not found',
  })
  async triggerScheduling(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Verify campaign belongs to user
    await this.followupsService.findOne(userId, id);

    const scheduledCount =
      await this.followupsService.scheduleFollowupsForCampaign(id);

    return {
      message: `Scheduled ${scheduledCount} follow-up messages`,
      scheduledCount,
    };
  }

  // ==================== Contact Followup Endpoints (Simple) ====================

  @Post('contact')
  @ApiOperation({
    summary: 'Create contact follow-up',
    description: 'Schedule a follow-up message for a specific phone number',
  })
  @ApiResponse({
    status: 201,
    description: 'Contact follow-up created',
  })
  async createContactFollowup(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateContactFollowupDto,
  ) {
    return this.contactFollowupService.create(userId, dto);
  }

  @Delete('contact/:id')
  @ApiOperation({
    summary: 'Delete contact follow-up',
    description: 'Delete/cancel a scheduled contact follow-up',
  })
  @ApiResponse({
    status: 200,
    description: 'Contact follow-up deleted',
  })
  async deleteContactFollowup(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.contactFollowupService.delete(userId, id);
    return { message: 'Contact follow-up deleted successfully' };
  }
}
