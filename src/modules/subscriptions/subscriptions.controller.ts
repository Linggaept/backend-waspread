import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // Get current active subscription
  @Get('current')
  getCurrentSubscription(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getActiveSubscription(userId);
  }

  // Check quota
  @Get('quota')
  checkQuota(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.checkQuota(userId);
  }

  // Get user's subscription history
  @Get('my-subscriptions')
  findMySubscriptions(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.findByUser(userId);
  }

  // Admin: get all subscriptions
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.subscriptionsService.findAll();
  }
}
