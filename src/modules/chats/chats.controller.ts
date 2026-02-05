import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatsService } from './chats.service';
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
  constructor(private readonly chatsService: ChatsService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations sorted by latest message' })
  async getConversations(
    @CurrentUser('id') userId: string,
    @Query() query: ConversationQueryDto,
  ) {
    return this.chatsService.getConversations(userId, query);
  }

  @Get('conversations/:phoneNumber')
  @ApiOperation({ summary: 'Get chat history with a specific phone number' })
  async getChatHistory(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Query() query: ChatHistoryQueryDto,
  ) {
    return this.chatsService.getChatHistory(userId, phoneNumber, query);
  }

  @Post('conversations/:phoneNumber/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    return this.chatsService.markConversationAsRead(userId, phoneNumber);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send text message from inbox' })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() dto: ChatSendMessageDto,
  ) {
    return this.chatsService.sendTextMessage(
      userId,
      dto.phoneNumber,
      dto.message,
    );
  }

  @Post('send-media')
  @ApiOperation({ summary: 'Send message with media from inbox' })
  async sendMedia(
    @CurrentUser('id') userId: string,
    @Body() dto: ChatSendMediaDto,
  ) {
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
  async getUnreadCount(@CurrentUser('id') userId: string) {
    return this.chatsService.getUnreadCount(userId);
  }
}
