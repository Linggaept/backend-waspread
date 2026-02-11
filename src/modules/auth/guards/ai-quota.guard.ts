import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

@Injectable()
export class AiQuotaGuard implements CanActivate {
  constructor(private subscriptionsService: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const { hasAccess, message } =
      await this.subscriptionsService.checkAiQuota(userId);

    if (!hasAccess) {
      throw new ForbiddenException(message || 'AI quota exceeded');
    }

    return true;
  }
}
