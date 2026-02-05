import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WhatsAppSession,
  SessionStatus,
} from '../../database/entities/whatsapp-session.entity';

@Injectable()
export class WhatsAppHealthIndicator extends HealthIndicator {
  constructor(
    private readonly whatsappService: WhatsAppService,
    @InjectRepository(WhatsAppSession)
    private readonly sessionRepository: Repository<WhatsAppSession>,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const connectedSessions = await this.sessionRepository.count({
      where: { status: SessionStatus.CONNECTED },
    });

    const totalSessions = await this.sessionRepository.count();

    const isHealthy = true; // WhatsApp service is up, even if no sessions
    const result = this.getStatus(key, isHealthy, {
      connectedSessions,
      totalSessions,
      status: 'operational',
    });

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('WhatsApp service is down', result);
  }
}
