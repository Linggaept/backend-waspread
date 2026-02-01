import {
  Controller,
  Get,
  Post,
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
import { CreateBlastDto, BlastResponseDto, BlastDetailDto, BlastQueryDto } from './dto';
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
    private readonly uploadsService: UploadsService,
    private readonly contactsService: ContactsService,
    private readonly templatesService: TemplatesService,
  ) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'phonesFile', maxCount: 1 },
      { name: 'imageFile', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Create blast campaign',
    description:
      'Create a new blast campaign. Phone numbers can be provided via phoneNumbers array or phonesFile (CSV/Excel). Optionally include an image attachment.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          example: 'January Promo',
          description: 'Campaign name',
        },
        message: {
          type: 'string',
          example: 'Hello! Check out our new products.',
          description: 'Message content. Required if templateId is not provided.',
        },
        templateId: {
          type: 'string',
          example: 'template-uuid',
          description: 'Template ID to use. If provided, message and image will be taken from template.',
        },
        variableValues: {
          type: 'object',
          example: { name: 'John', product: 'Laptop' },
          description: 'Variable values to replace in template message (JSON string for multipart).',
        },
        phoneNumbers: {
          type: 'array',
          items: { type: 'string' },
          example: ['628123456789', '628987654331'],
          description:
            'Target phone numbers. Required if phonesFile/contactTag is not provided.',
        },
        contactTag: {
          type: 'string',
          example: 'customer',
          description: 'Contact tag to select recipients from saved contacts.',
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
            'CSV/Excel file with phone numbers in first column.',
        },
        imageFile: {
          type: 'string',
          format: 'binary',
          description:
            'Optional image to attach (overrides template image if provided).',
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
      imageFile?: Express.Multer.File[];
    },
  ) {
    const phonesFile = files?.phonesFile?.[0];
    const imageFile = files?.imageFile?.[0];

    let phoneNumbers = createBlastDto.phoneNumbers;
    let imageUrl: string | undefined;
    let message = createBlastDto.message;

    try {
      // If templateId is provided, get message and image from template
      if (createBlastDto.templateId) {
        const templateData = await this.templatesService.getTemplateForBlast(
          userId,
          createBlastDto.templateId,
          createBlastDto.variableValues,
        );
        message = templateData.message;
        // Only use template image if no imageFile is uploaded
        if (!imageFile && templateData.imageUrl) {
          imageUrl = templateData.imageUrl;
        }
      }

      // Validate that we have a message
      if (!message) {
        throw new BadRequestException(
          'Message is required. Provide message content or use a templateId.',
        );
      }

      // Process phone numbers file if provided
      if (phonesFile) {
        this.uploadsService.validatePhoneFile(phonesFile);
        const parsed = this.uploadsService.parsePhoneNumbersFile(phonesFile.path);
        phoneNumbers = parsed.phoneNumbers;
        // Cleanup temp file after parsing
        this.uploadsService.cleanupTempFile(phonesFile.path);
      } else if (createBlastDto.contactTag) {
        // Fetch phone numbers from contacts by tag
        phoneNumbers = await this.contactsService.getPhoneNumbersByTag(
          userId,
          createBlastDto.contactTag,
        );
      }

      // Validate that we have phone numbers from either source
      if (!phoneNumbers || phoneNumbers.length === 0) {
        throw new BadRequestException(
          'Phone numbers are required. Provide phoneNumbers array, upload a phonesFile, or specify a contactTag.',
        );
      }

      // Process image file if provided (overrides template image)
      if (imageFile) {
        this.uploadsService.validateImageFile(imageFile);
        imageUrl = await this.uploadsService.moveToUserDirectory(
          imageFile.path,
          userId,
          'images',
        );
      }

      // Set phone numbers and message in DTO
      createBlastDto.phoneNumbers = phoneNumbers;
      createBlastDto.message = message;

      return this.blastsService.create(userId, createBlastDto, imageUrl);
    } catch (error) {
      // Cleanup files on error
      this.uploadsService.cleanupFiles(
        phonesFile?.path,
        imageFile?.path,
        imageUrl,
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

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all blasts (Admin)' })
  @ApiResponse({ status: 200, description: 'List of all system blasts' })
  findAllAdmin() {
    return this.blastsService.findAllAdmin();
  }
}
