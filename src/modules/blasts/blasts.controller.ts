import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { BlastsService } from './blasts.service';
import { BlastRepliesService } from './services/blast-replies.service';
import {
  CreateBlastDto,
  BlastResponseDto,
  BlastDetailDto,
  BlastQueryDto,
  ReplyQueryDto,
  BlastReplyDto,
  ReplyStatsDto,
  BlastAdminQueryDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { UploadsService } from '../uploads/uploads.service';
import { ContactsService } from '../contacts/contacts.service';
import { TemplatesService } from '../templates/templates.service';

@ApiTags('Blasts')
@ApiBearerAuth('JWT-auth')
@Controller('blasts')
@UseGuards(JwtAuthGuard)
export class BlastsController {
  constructor(
    private readonly blastsService: BlastsService,
    private readonly blastRepliesService: BlastRepliesService,
    private readonly uploadsService: UploadsService,
    private readonly contactsService: ContactsService,
    private readonly templatesService: TemplatesService,
  ) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'phonesFile', maxCount: 1 },
      { name: 'mediaFile', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Create blast campaign',
    description:
      'Create a new blast campaign. Recipients can be selected via: manual (input numbers), from_contacts (select from saved contacts), or file (upload CSV/Excel).',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'recipientSource'],
      properties: {
        name: {
          type: 'string',
          example: 'January Promo',
          description: 'Campaign name',
        },
        message: {
          type: 'string',
          example: 'Hello! Check out our new products.',
          description:
            'Message content. Required if templateId is not provided.',
        },
        templateId: {
          type: 'string',
          example: 'template-uuid',
          description:
            'Template ID to use. If provided, message and media will be taken from template.',
        },
        variableValues: {
          type: 'object',
          example: { name: 'John', product: 'Laptop' },
          description:
            'Variable values to replace in template message (JSON string for multipart).',
        },
        recipientSource: {
          type: 'string',
          enum: ['manual', 'from_contacts', 'file'],
          example: 'manual',
          description:
            'How to select recipients: manual (input numbers min 2), from_contacts (select from saved contacts), file (upload CSV/Excel).',
        },
        phoneNumbers: {
          type: 'array',
          items: { type: 'string' },
          example: ['628123456789', '628987654331'],
          description:
            'Target phone numbers (when recipientSource = manual). Minimum 2 numbers.',
        },
        contactIds: {
          type: 'array',
          items: { type: 'string' },
          example: ['contact-uuid-1', 'contact-uuid-2'],
          description:
            'Selected contact IDs from checkbox (when recipientSource = from_contacts).',
        },
        delayMs: {
          type: 'number',
          example: 3000,
          description: 'Delay between messages in ms (minimum 1000)',
        },
        phonesFile: {
          type: 'string',
          format: 'binary',
          description:
            'CSV/Excel file with phone numbers (when recipientSource = file).',
        },
        mediaFile: {
          type: 'string',
          format: 'binary',
          description:
            'Optional media attachment (image, video, audio, or document).',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Blast created successfully',
    type: BlastResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or file format',
  })
  async create(
    @CurrentUser('id') userId: string,
    @Body() createBlastDto: CreateBlastDto,
    @UploadedFiles()
    files?: {
      phonesFile?: Express.Multer.File[];
      mediaFile?: Express.Multer.File[];
    },
  ) {
    const phonesFile = files?.phonesFile?.[0];
    const mediaFile = files?.mediaFile?.[0];

    let phoneNumbers: string[] = [];
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let message = createBlastDto.message;

    try {
      // If templateId is provided, get message and media from template
      if (createBlastDto.templateId) {
        const templateData = await this.templatesService.getTemplateForBlast(
          userId,
          createBlastDto.templateId,
          createBlastDto.variableValues,
        );
        message = templateData.message;
        // Only use template media if no mediaFile is uploaded
        if (!mediaFile && templateData.mediaUrl) {
          mediaUrl = templateData.mediaUrl;
          mediaType = templateData.mediaType;
        }
      }

      // Validate that we have a message
      if (!message) {
        throw new BadRequestException(
          'Message is required. Provide message content or use a templateId.',
        );
      }

      // Determine recipient source (default to 'manual' for backwards compatibility)
      const recipientSource = createBlastDto.recipientSource || 'manual';

      // Get phone numbers based on recipient source
      switch (recipientSource) {
        case 'manual':
          // Use phoneNumbers from DTO (minimum 2 numbers)
          phoneNumbers = createBlastDto.phoneNumbers || [];
          if (phoneNumbers.length < 2) {
            throw new BadRequestException(
              'Minimum 2 phone numbers required for manual input.',
            );
          }
          break;

        case 'from_contacts':
          // Get phone numbers from selected contact IDs
          if (
            !createBlastDto.contactIds ||
            createBlastDto.contactIds.length === 0
          ) {
            throw new BadRequestException(
              'contactIds is required when recipientSource is "from_contacts". Please select at least one contact.',
            );
          }
          phoneNumbers = await this.contactsService.getPhoneNumbersByIds(
            userId,
            createBlastDto.contactIds,
          );
          if (phoneNumbers.length === 0) {
            throw new BadRequestException(
              'No valid contacts found for the selected IDs.',
            );
          }
          break;

        case 'file':
          // Parse phone numbers from uploaded file
          if (!phonesFile) {
            throw new BadRequestException(
              'phonesFile is required when recipientSource is "file".',
            );
          }
          this.uploadsService.validatePhoneFile(phonesFile);
          const parsed = await this.uploadsService.parsePhoneNumbersFile(
            phonesFile.path,
          );
          phoneNumbers = parsed.phoneNumbers;
          this.uploadsService.cleanupTempFile(phonesFile.path);
          if (phoneNumbers.length === 0) {
            throw new BadRequestException(
              'No valid phone numbers found in the uploaded file.',
            );
          }
          break;

        default:
          throw new BadRequestException(
            `Invalid recipientSource: ${recipientSource}. Use "manual", "from_contacts", or "file".`,
          );
      }

      // Process media file if provided (overrides template media)
      if (mediaFile) {
        mediaType = this.uploadsService.validateMediaFile(mediaFile);
        mediaUrl = await this.uploadsService.moveToUserDirectory(
          mediaFile.path,
          userId,
          'media',
          mediaFile.originalname,
        );
      }

      // Set phone numbers and message in DTO
      createBlastDto.phoneNumbers = phoneNumbers;
      createBlastDto.message = message;

      return this.blastsService.create(
        userId,
        createBlastDto,
        mediaUrl,
        mediaType,
      );
    } catch (error) {
      // Cleanup files on error
      this.uploadsService.cleanupFiles(
        phonesFile?.path,
        mediaFile?.path,
        mediaUrl,
      );
      throw error;
    }
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start blast campaign' })
  @ApiResponse({ status: 200, description: 'Blast started successfully' })
  startBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.startBlast(userId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel blast campaign' })
  @ApiResponse({ status: 200, description: 'Blast cancelled successfully' })
  cancelBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.cancelBlast(userId, id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all user blasts with pagination and search' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of blasts',
  })
  findAll(@CurrentUser('id') userId: string, @Query() query: BlastQueryDto) {
    return this.blastsService.findAll(userId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get blast statistics' })
  @ApiResponse({ status: 200, description: 'User blast statistics' })
  getStats(@CurrentUser('id') userId: string) {
    return this.blastsService.getStats(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blast details' })
  @ApiResponse({
    status: 200,
    description: 'Blast details',
    type: BlastResponseDto,
  })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.findOne(userId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get blast with message details' })
  @ApiResponse({
    status: 200,
    description: 'Blast details with messages',
    type: BlastDetailDto,
  })
  findOneWithMessages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.findOneWithMessages(userId, id);
  }

  @Get('replies/unread')
  @ApiOperation({ summary: 'Get all unread replies across all blasts' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of unread replies',
  })
  findUnreadReplies(
    @CurrentUser('id') userId: string,
    @Query() query: ReplyQueryDto,
  ) {
    return this.blastRepliesService.findUnread(userId, query);
  }

  @Get('replies/stats')
  @ApiOperation({ summary: 'Get reply statistics' })
  @ApiResponse({
    status: 200,
    description: 'Reply statistics',
    type: ReplyStatsDto,
  })
  getReplyStats(@CurrentUser('id') userId: string) {
    return this.blastRepliesService.getStats(userId);
  }

  @Get(':id/replies')
  @ApiOperation({ summary: 'Get replies for a specific blast' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of replies',
  })
  findBlastReplies(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) blastId: string,
    @Query() query: ReplyQueryDto,
  ) {
    return this.blastRepliesService.findByBlast(userId, blastId, query);
  }

  @Get(':id/replies/:replyId')
  @ApiOperation({ summary: 'Get a specific reply' })
  @ApiResponse({
    status: 200,
    description: 'Reply details',
    type: BlastReplyDto,
  })
  findOneReply(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) blastId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ) {
    return this.blastRepliesService.findOne(userId, blastId, replyId);
  }

  @Patch(':id/replies/:replyId/read')
  @ApiOperation({ summary: 'Mark a reply as read' })
  @ApiResponse({
    status: 200,
    description: 'Reply marked as read',
    type: BlastReplyDto,
  })
  markReplyAsRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) blastId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ) {
    return this.blastRepliesService.markAsRead(userId, blastId, replyId);
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all blasts with pagination (Admin)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of all system blasts',
  })
  async findAllAdmin(@Query() query: BlastAdminQueryDto) {
    const { data, total } = await this.blastsService.findAllAdmin(query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }
}
