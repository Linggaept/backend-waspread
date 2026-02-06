import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Res,
} from '@nestjs/common';
import * as express from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatsService } from './chats.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  ConversationQueryDto,
  ChatHistoryQueryDto,
  ChatSendMessageDto,
  ChatSendMediaDto,
} from './dto';

@ApiTags('Chats')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  /**
   * Helper to set X-Session-Phone-Number header
   */
  private async setSessionHeader(res: express.Response, userId: string): Promise<void> {
    const session = await this.whatsAppService.getSessionStatus(userId);
    if (session?.phoneNumber) {
      res.setHeader('X-Session-Phone-Number', session.phoneNumber);
    }
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations sorted by latest message' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async getConversations(
    @CurrentUser('id') userId: string,
    @Query() query: ConversationQueryDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.getConversations(userId, query);
  }

  @Get('conversations/:phoneNumber')
  @ApiOperation({ summary: 'Get chat history with a specific phone number' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async getChatHistory(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Query() query: ChatHistoryQueryDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.getChatHistory(userId, phoneNumber, query);
  }

  @Post('conversations/:phoneNumber/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.markConversationAsRead(userId, phoneNumber);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send text message from inbox' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() dto: ChatSendMessageDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.sendTextMessage(
      userId,
      dto.phoneNumber,
      dto.message,
    );
  }

  @Post('send-media')
  @ApiOperation({ summary: 'Send message with media from inbox' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async sendMedia(
    @CurrentUser('id') userId: string,
    @Body() dto: ChatSendMediaDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.sendMediaMessage(
      userId,
      dto.phoneNumber,
      dto.message || '',
      dto.mediaPath,
      dto.mediaType,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get total unread message count' })
  @ApiHeader({
    name: 'X-Session-Phone-Number',
    description: 'The connected WhatsApp phone number for this session',
    required: false,
  })
  async getUnreadCount(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.getUnreadCount(userId);
  }
}
