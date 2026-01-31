import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { SendMessageDto } from './dto';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  // Initialize/Connect WhatsApp session
  @Post('connect')
  async connect(@CurrentUser('id') userId: string) {
    try {
      return await this.whatsappService.initializeSession(userId);
    } catch (error) {
      throw new BadRequestException(`Failed to connect: ${error}`);
    }
  }

  // Disconnect session
  @Delete('disconnect')
  async disconnect(@CurrentUser('id') userId: string) {
    await this.whatsappService.disconnectSession(userId);
    return { message: 'Session disconnected successfully' };
  }

  // Get session status
  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    const session = await this.whatsappService.getSessionStatus(userId);
    const isReady = await this.whatsappService.isSessionReady(userId);
    
    return {
      session: session || { status: 'disconnected' },
      isReady,
    };
  }

  // Send a single message
  @Post('send')
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException('WhatsApp session is not connected');
    }

    try {
      await this.whatsappService.sendMessage(
        userId,
        sendMessageDto.phoneNumber,
        sendMessageDto.message,
      );
      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      throw new BadRequestException(`Failed to send message: ${error}`);
    }
  }

  // Admin: Get all sessions
  @Get('sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllSessions() {
    return this.whatsappService.getAllSessions();
  }
}
