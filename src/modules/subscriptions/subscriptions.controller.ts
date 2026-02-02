import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current active subscription' })
  @ApiResponse({ status: 200, description: 'Active subscription details' })
  getCurrentSubscription(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getActiveSubscription(userId);
  }

  @Get('quota')
  @ApiOperation({ summary: 'Check remaining quota' })
  @ApiResponse({ status: 200, description: 'Quota status (hasSubscription, remainingQuota, etc.)' })
  checkQuota(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.checkQuota(userId);
  }

  @Get('my-subscriptions')
  @ApiOperation({ summary: 'Get subscription history' })
  @ApiResponse({ status: 200, description: 'List of user subscriptions' })
  findMySubscriptions(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.findByUser(userId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all subscriptions with pagination (Admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of all subscriptions' })
  async findAll(@Query() query: SubscriptionQueryDto) {
    const { data, total } = await this.subscriptionsService.findAll(query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }
}

