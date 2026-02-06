import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { ChatsService } from './chats.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  ConversationQueryDto,
  ChatHistoryQueryDto,
  ChatSendMessageDto,
} from './dto';

@ApiTags('Chats')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly whatsAppService: WhatsAppService,
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Helper to set X-Session-Phone-Number response header
   */
  private async setSessionHeader(res: express.Response, userId: string): Promise<void> {
    const session = await this.whatsAppService.getSessionStatus(userId);
    if (session?.phoneNumber) {
      res.setHeader('X-Session-Phone-Number', session.phoneNumber);
    }
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations sorted by latest message' })
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
  @UseInterceptors(FileInterceptor('media'))
  @ApiOperation({ summary: 'Send message with media from inbox' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phoneNumber', 'media'],
      properties: {
        phoneNumber: {
          type: 'string',
          description: 'Recipient phone number (e.g. 628123456789)',
          example: '628123456789',
        },
        message: {
          type: 'string',
          description: 'Optional caption for the media',
          example: 'Check this out!',
        },
        media: {
          type: 'string',
          format: 'binary',
          description: 'Media file (image, video, audio, or document)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Media message sent' })
  @ApiResponse({ status: 400, description: 'Invalid file or session not connected' })
  async sendMedia(
    @CurrentUser('id') userId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('message') message: string,
    @UploadedFile() file: Express.Multer.File,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);

    if (!phoneNumber) {
      throw new BadRequestException('phoneNumber is required');
    }

    if (!file) {
      throw new BadRequestException('media file is required');
    }

    // Validate and get media type
    const mediaType = this.uploadsService.validateMediaFile(file);

    // Save file and get URL
    const mediaUrl = await this.uploadsService.moveToUserDirectory(
      file.path,
      userId,
      'media',
      file.originalname,
    );

    return this.chatsService.sendMediaMessage(
      userId,
      phoneNumber,
      message || '',
      mediaUrl,
      mediaType,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get total unread message count' })
  async getUnreadCount(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.getUnreadCount(userId);
  }

  // ==================== Delete & Retract ====================

  @Delete('conversations/:phoneNumber')
  @ApiOperation({ summary: 'Delete entire conversation with a phone number' })
  @ApiResponse({ status: 200, description: 'Conversation deleted' })
  async deleteConversation(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.deleteConversation(userId, phoneNumber);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a single message (local only)' })
  @ApiResponse({ status: 200, description: 'Message deleted locally' })
  async deleteMessage(
    @CurrentUser('id') userId: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.deleteMessage(userId, messageId);
  }

  @Post('messages/:messageId/retract')
  @ApiOperation({
    summary: 'Retract a message (delete for everyone on WhatsApp)',
    description: 'Only works for outgoing messages that have a WhatsApp message ID',
  })
  @ApiResponse({ status: 200, description: 'Message retracted' })
  @ApiResponse({ status: 400, description: 'Cannot retract this message' })
  async retractMessage(
    @CurrentUser('id') userId: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.retractMessage(userId, messageId);
  }

  // ==================== Pin/Unpin ====================

  @Post('conversations/:phoneNumber/pin')
  @ApiOperation({ summary: 'Pin a conversation' })
  @ApiResponse({ status: 201, description: 'Conversation pinned' })
  async pinConversation(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.pinConversation(userId, phoneNumber);
  }

  @Delete('conversations/:phoneNumber/pin')
  @ApiOperation({ summary: 'Unpin a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation unpinned' })
  async unpinConversation(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.setSessionHeader(res, userId);
    return this.chatsService.unpinConversation(userId, phoneNumber);
  }

  // ==================== Admin: Retention Management ====================

  @Get('admin/retention-stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get message retention statistics (Admin only)',
    description: 'Returns stats about message retention policy and cleanup status',
  })
  @ApiResponse({
    status: 200,
    description: 'Retention stats',
    schema: {
      type: 'object',
      properties: {
        retentionDays: { type: 'number', example: 30 },
        totalMessages: { type: 'number', example: 15000 },
        oldestMessage: { type: 'string', format: 'date-time' },
        messagesOlderThanRetention: { type: 'number', example: 500 },
      },
    },
  })
  async getRetentionStats() {
    return this.chatsService.getRetentionStats();
  }

  @Post('admin/cleanup')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Manually trigger message cleanup (Admin only)',
    description: 'Deletes messages older than the retention period',
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'number', example: 500 },
      },
    },
  })
  async triggerCleanup() {
    return this.chatsService.cleanupOldMessages();
  }
}
