import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard, FeatureGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeature } from '../auth/decorators/feature.decorator';
import { AiService } from './ai.service';
import { AiTokenService } from './services/ai-token.service';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  KnowledgeQueryDto,
  BulkDeleteKnowledgeDto,
  UpdateAiSettingsDto,
  SuggestRequestDto,
  UpdateAutoReplySettingsDto,
  AddBlacklistDto,
  AutoReplyLogQueryDto,
} from './dto';
import { AutoReplyService } from './services/auto-reply.service';
import { AiFeatureType } from '../../database/entities/ai-token-usage.entity';

@ApiTags('AI Smart Reply')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiTokenService: AiTokenService,
    private readonly autoReplyService: AutoReplyService,
  ) {}

  // ==================== KNOWLEDGE BASE ====================

  @Post('knowledge')
  @ApiOperation({ summary: 'Create knowledge base entry' })
  @ApiResponse({ status: 201, description: 'Knowledge entry created' })
  createKnowledge(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateKnowledgeDto,
  ) {
    return this.aiService.createKnowledge(userId, dto);
  }

  @Get('knowledge')
  @ApiOperation({ summary: 'List all knowledge base entries' })
  @ApiResponse({ status: 200, description: 'List of knowledge entries' })
  findAllKnowledge(
    @CurrentUser('id') userId: string,
    @Query() query: KnowledgeQueryDto,
  ) {
    return this.aiService.findAllKnowledge(userId, query);
  }

  @Get('knowledge/:id')
  @ApiOperation({ summary: 'Get single knowledge base entry' })
  @ApiResponse({ status: 200, description: 'Knowledge entry' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOneKnowledge(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiService.findOneKnowledge(userId, id);
  }

  @Put('knowledge/:id')
  @ApiOperation({ summary: 'Update knowledge base entry' })
  @ApiResponse({ status: 200, description: 'Knowledge entry updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  updateKnowledge(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeDto,
  ) {
    return this.aiService.updateKnowledge(userId, id, dto);
  }

  @Delete('knowledge/:id')
  @ApiOperation({ summary: 'Delete knowledge base entry' })
  @ApiResponse({ status: 200, description: 'Knowledge entry deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteKnowledge(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.aiService.deleteKnowledge(userId, id);
    return { message: 'Knowledge entry deleted' };
  }

  @Post('knowledge/bulk-delete')
  @ApiOperation({ summary: 'Bulk delete knowledge base entries' })
  @ApiResponse({
    status: 200,
    description: 'Bulk delete completed',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'number', example: 5 },
        failed: { type: 'number', example: 1 },
      },
    },
  })
  bulkDeleteKnowledge(
    @CurrentUser('id') userId: string,
    @Body() dto: BulkDeleteKnowledgeDto,
  ) {
    return this.aiService.bulkDeleteKnowledge(userId, dto.ids);
  }

  @Post('knowledge/import')
  @ApiOperation({ summary: 'Bulk import knowledge base entries (JSON array)' })
  @ApiResponse({ status: 201, description: 'Import completed' })
  bulkImportKnowledge(
    @CurrentUser('id') userId: string,
    @Body() entries: CreateKnowledgeDto[],
  ) {
    return this.aiService.bulkImportKnowledge(userId, entries);
  }

  @Post('knowledge/import-file')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Import knowledge base from CSV/Excel file',
    description: `Upload CSV or Excel file with columns: category, title, content, keywords (comma-separated).

**Supported formats:** .csv, .xlsx, .xls

**Example CSV:**
\`\`\`
category,title,content,keywords
product,Paket Basic,Harga 99rb/bulan fitur 1000 blast,"basic,murah,99"
product,Paket Premium,Harga 199rb/bulan unlimited blast,"premium,unlimited"
faq,Cara Bayar,Transfer bank atau e-wallet,"bayar,transfer"
\`\`\``,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV or Excel file',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Import completed',
    schema: {
      type: 'object',
      properties: {
        imported: { type: 'number', example: 10 },
        failed: { type: 'number', example: 2 },
        errors: {
          type: 'array',
          items: { type: 'string' },
          example: ['Row 3: Missing title'],
        },
      },
    },
  })
  async importKnowledgeFile(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      throw new BadRequestException('Only CSV and Excel files are supported');
    }

    return this.aiService.importKnowledgeFromFile(userId, file.path);
  }

  @Post('knowledge/import-file-ai')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Import knowledge base from PDF/Image using AI',
    description: `Upload PDF or Image file. Gemini AI will analyze and extract knowledge items automatically.

    **Supported formats:** .pdf, .jpg, .jpeg, .png, .webp
    `,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF or Image file',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'AI Import completed',
    schema: {
      type: 'object',
      properties: {
        imported: { type: 'number', example: 5 },
        failed: { type: 'number', example: 0 },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              category: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'AI quota exceeded' })
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Max 10 AI calls per minute
  async importKnowledgeFileAi(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Supported formats: PDF, Image, CSV, Excel',
      );
    }

    // Check token balance first (5 tokens for AI knowledge import)
    const balance = await this.aiTokenService.checkBalance(
      userId,
      AiFeatureType.KNOWLEDGE_IMPORT,
    );
    if (!balance.hasEnough) {
      throw new BadRequestException(
        `Insufficient AI tokens. Required: ${balance.required}, Available: ${balance.balance}`,
      );
    }

    let filePath = file.path;
    let mimeType = file.mimetype;

    // 1. Convert Excel to CSV if needed (Gemini prefers text/csv)
    if (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      filePath = await this.aiService.convertExcelToCsv(file.path);
      mimeType = 'text/csv';
    }

    // 2. Upload to Gemini
    const fileUri = await this.aiService.uploadFileToGemini(filePath, mimeType);

    // 2. Extract Knowledge
    const knowledgeItems = await this.aiService.generateKnowledgeFromMedia(
      fileUri,
      file.mimetype,
    );

    // 3. Save to DB
    const result = await this.aiService.bulkImportKnowledge(
      userId,
      knowledgeItems,
    );

    // Use tokens for AI-powered import (auto-calculated: 5 tokens)
    await this.aiTokenService.useTokens(userId, AiFeatureType.KNOWLEDGE_IMPORT);

    return result;
  }

  // ==================== SETTINGS ====================

  @Get('settings')
  @ApiOperation({ summary: 'Get AI settings' })
  @ApiResponse({
    status: 200,
    description: 'AI settings',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        isEnabled: { type: 'boolean' },
        businessName: { type: 'string', nullable: true },
        businessDescription: { type: 'string', nullable: true },
        replyTone: { type: 'string', enum: ['formal', 'casual', 'friendly'] },
      },
    },
  })
  getSettings(@CurrentUser('id') userId: string) {
    return this.aiService.getSettings(userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update AI settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAiSettingsDto,
  ) {
    return this.aiService.updateSettings(userId, dto);
  }

  // ==================== SUGGEST (Core Feature) ====================

  @Post('suggest')
  @ApiOperation({
    summary: 'Generate AI reply suggestions',
    description:
      'Generates 3 reply suggestions based on knowledge base and chat history context',
  })
  @ApiResponse({
    status: 200,
    description: '3 reply suggestions',
    schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Paket Premium 199rb/bulan kak 😊',
            'Untuk Premium 199k/bln kak. Mau detail fiturnya?',
            'Premium cuma 199k aja kak, lagi promo! 🔥',
          ],
        },
        context: {
          type: 'object',
          properties: {
            knowledgeUsed: {
              type: 'array',
              items: { type: 'string' },
              example: ['Paket Premium', 'Promo Akhir Bulan'],
            },
            chatHistoryUsed: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'AI disabled or error' })
  @ApiResponse({ status: 403, description: 'Insufficient AI tokens' })
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Max 10 AI calls per minute
  async generateSuggestions(
    @CurrentUser('id') userId: string,
    @Body() dto: SuggestRequestDto,
  ) {
    // Check token balance first (minimum ~20 tokens for text suggestions)
    const minTokensRequired = 20;
    const balance = await this.aiTokenService.checkBalance(
      userId,
      minTokensRequired,
    );
    if (!balance.hasEnough) {
      throw new BadRequestException(
        `Insufficient AI tokens. Required: ~${minTokensRequired}, Available: ${balance.balance}`,
      );
    }

    const result = await this.aiService.generateSuggestions(userId, dto);

    // Use tokens based on actual Gemini usage (dynamic pricing)
    if (result.tokenUsage.platformTokens > 0) {
      await this.aiTokenService.useTokens(
        userId,
        AiFeatureType.SUGGEST,
        result.tokenUsage.platformTokens,
      );
    }

    return {
      suggestions: result.suggestions,
      context: result.context,
      tokensUsed: result.tokenUsage.platformTokens,
    };
  }

  // ==================== AUTO-REPLY ====================

  @Get('auto-reply/settings')
  @ApiOperation({ summary: 'Get auto-reply settings' })
  @ApiResponse({
    status: 200,
    description: 'Auto-reply settings',
    schema: {
      type: 'object',
      properties: {
        autoReplyEnabled: { type: 'boolean' },
        workingHoursStart: { type: 'string', nullable: true, example: '08:00' },
        workingHoursEnd: { type: 'string', nullable: true, example: '21:00' },
        workingHoursEnabled: { type: 'boolean' },
        autoReplyDelayMin: { type: 'number', example: 5 },
        autoReplyDelayMax: { type: 'number', example: 10 },
        autoReplyCooldownMinutes: { type: 'number', example: 60 },
        autoReplyFallbackMessage: { type: 'string', nullable: true },
      },
    },
  })
  getAutoReplySettings(@CurrentUser('id') userId: string) {
    return this.autoReplyService.getAutoReplySettings(userId);
  }

  @Put('auto-reply/settings')
  @ApiOperation({ summary: 'Update auto-reply settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  updateAutoReplySettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAutoReplySettingsDto,
  ) {
    return this.autoReplyService.updateAutoReplySettings(userId, dto);
  }

  @Get('auto-reply/blacklist')
  @ApiOperation({ summary: 'Get blacklisted phone numbers' })
  @ApiResponse({
    status: 200,
    description: 'List of blacklisted numbers',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              phoneNumber: { type: 'string' },
              reason: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  getBlacklist(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.autoReplyService.getBlacklist(userId, page, limit);
  }

  @Post('auto-reply/blacklist')
  @ApiOperation({ summary: 'Add phone number to blacklist' })
  @ApiResponse({ status: 201, description: 'Number added to blacklist' })
  addToBlacklist(
    @CurrentUser('id') userId: string,
    @Body() dto: AddBlacklistDto,
  ) {
    return this.autoReplyService.addToBlacklist(userId, dto);
  }

  @Delete('auto-reply/blacklist/:phoneNumber')
  @ApiOperation({ summary: 'Remove phone number from blacklist' })
  @ApiResponse({ status: 200, description: 'Number removed from blacklist' })
  async removeFromBlacklist(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    const removed = await this.autoReplyService.removeFromBlacklist(
      userId,
      phoneNumber,
    );
    return { removed };
  }

  @Post('auto-reply/toggle/:phoneNumber')
  @ApiOperation({
    summary: 'Toggle auto-reply for a specific phone number',
    description:
      'If auto-reply is enabled for this number, it will be disabled (added to blacklist). If disabled, it will be enabled (removed from blacklist).',
  })
  @ApiResponse({
    status: 200,
    description: 'Auto-reply toggled',
    schema: {
      type: 'object',
      properties: {
        phoneNumber: { type: 'string', example: '6281234567890' },
        isAutoReply: {
          type: 'boolean',
          description: 'New state: true = will receive auto-reply',
        },
      },
    },
  })
  async toggleAutoReply(
    @CurrentUser('id') userId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    const isBlacklisted = await this.autoReplyService.isBlacklisted(
      userId,
      phoneNumber,
    );

    if (isBlacklisted) {
      // Currently blacklisted (no auto-reply), remove from blacklist
      await this.autoReplyService.removeFromBlacklist(userId, phoneNumber);
      return { phoneNumber, isAutoReply: true };
    } else {
      // Currently not blacklisted (has auto-reply), add to blacklist
      await this.autoReplyService.addToBlacklist(userId, {
        phoneNumber,
        reason: 'Disabled via toggle',
      });
      return { phoneNumber, isAutoReply: false };
    }
  }

  @Get('auto-reply/logs')
  @ApiOperation({ summary: 'Get auto-reply activity logs' })
  @ApiResponse({
    status: 200,
    description: 'List of auto-reply logs',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              phoneNumber: { type: 'string' },
              incomingMessageBody: { type: 'string' },
              replyMessage: { type: 'string', nullable: true },
              status: {
                type: 'string',
                enum: ['queued', 'sent', 'failed', 'skipped'],
              },
              skipReason: { type: 'string', nullable: true },
              delaySeconds: { type: 'number', nullable: true },
              queuedAt: { type: 'string', format: 'date-time' },
              sentAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  getLogs(
    @CurrentUser('id') userId: string,
    @Query() query: AutoReplyLogQueryDto,
  ) {
    return this.autoReplyService.getLogs(userId, query);
  }
}
