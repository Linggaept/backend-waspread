import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { FEATURE_KEY, FeatureType } from '../decorators/feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<FeatureType>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No feature requirement, allow access
    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const { hasAccess, message } =
      await this.subscriptionsService.checkFeatureAccess(
        userId,
        requiredFeature,
      );

    if (!hasAccess) {
      throw new ForbiddenException(
        message || `Feature '${requiredFeature}' is not available`,
      );
    }

    return true;
  }
}
