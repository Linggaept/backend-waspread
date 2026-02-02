import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { SendMessageDto, SessionQueryDto } from './dto';

@ApiTags('WhatsApp')
@ApiBearerAuth('JWT-auth')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('connect')
  @ApiOperation({ summary: 'Initialize/Connect WhatsApp session' })
  @ApiResponse({ status: 201, description: 'Session initialized, returns QR code if needed' })
  async connect(@CurrentUser('id') userId: string) {
    try {
      return await this.whatsappService.initializeSession(userId);
    } catch (error) {
      throw new BadRequestException(`Failed to connect: ${error}`);
    }
  }

  @Post('reconnect')
  @ApiOperation({ summary: 'Force reconnect WhatsApp session (destroys existing and creates new)' })
  @ApiResponse({ status: 201, description: 'Session reinitialized' })
  async reconnect(@CurrentUser('id') userId: string) {
    try {
      // Force disconnect first
      await this.whatsappService.forceDisconnect(userId);
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Then connect
      return await this.whatsappService.initializeSession(userId);
    } catch (error) {
      throw new BadRequestException(`Failed to reconnect: ${error}`);
    }
  }

  @Delete('disconnect')
  @ApiOperation({ summary: 'Disconnect session' })
  @ApiResponse({ status: 200, description: 'Session disconnected' })
  async disconnect(@CurrentUser('id') userId: string) {
    await this.whatsappService.disconnectSession(userId);
    return { message: 'Session disconnected successfully' };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get session status' })
  @ApiResponse({ status: 200, description: 'Current session status and readiness' })
  async getStatus(@CurrentUser('id') userId: string) {
    const session = await this.whatsappService.getSessionStatus(userId);
    const isReady = await this.whatsappService.isSessionReady(userId);
    const stats = this.whatsappService.getSessionStats();
    
    return {
      session: session || { status: 'disconnected' },
      isReady,
      serverCapacity: stats,
    };
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a single message' })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Session not ready or send failed' })
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

  @Get('sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all sessions with pagination (Admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of all user sessions' })
  async getAllSessions(@Query() query: SessionQueryDto) {
    const { data, total } = await this.whatsappService.getAllSessions(query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }

  @Get('sessions/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get session server stats (Admin)' })
  @ApiResponse({ status: 200, description: 'Server capacity and active sessions' })
  getSessionStats() {
    return this.whatsappService.getSessionStats();
  }
}

