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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateResponseDto,
  TemplateQueryDto,
  UseTemplateDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UploadsService } from '../uploads/uploads.service';

@ApiTags('Templates')
@ApiBearerAuth('JWT-auth')
@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly uploadsService: UploadsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('mediaFile'))
  @ApiOperation({
    summary: 'Create a new template',
    description: 'Create a blast message template. Optionally include media (image, video, audio, or document).',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'message'],
      properties: {
        name: {
          type: 'string',
          example: 'Promo Template',
          description: 'Template name',
        },
        message: {
          type: 'string',
          example: 'Halo {name}! Ada promo spesial untuk kamu.',
          description: 'Message content. Use {variable} for placeholders.',
        },
        category: {
          type: 'string',
          example: 'promo',
          description: 'Category for organizing',
        },
        mediaFile: {
          type: 'string',
          format: 'binary',
          description: 'Optional media attachment (image, video, audio, document)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Template created', type: TemplateResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() createTemplateDto: CreateTemplateDto,
    @UploadedFile() mediaFile?: Express.Multer.File,
  ) {
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    try {
      if (mediaFile) {
        mediaType = this.uploadsService.validateMediaFile(mediaFile);
        mediaUrl = await this.uploadsService.moveToUserDirectory(
          mediaFile.path,
          userId,
          'media',
          mediaFile.originalname,
        );
      }

      return this.templatesService.create(userId, createTemplateDto, mediaUrl, mediaType);
    } catch (error) {
      // Cleanup on error
      if (mediaFile?.path) {
        this.uploadsService.cleanupTempFile(mediaFile.path);
      }
      if (mediaUrl) {
        this.uploadsService.cleanupTempFile(mediaUrl);
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all templates with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'List of templates' })
  findAll(@CurrentUser('id') userId: string, @Query() query: TemplateQueryDto) {
    return this.templatesService.findAll(userId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get all template categories' })
  @ApiResponse({ status: 200, description: 'List of categories', type: [String] })
  getCategories(@CurrentUser('id') userId: string) {
    return this.templatesService.getCategories(userId);
  }

  @Get('popular')
  @ApiOperation({ summary: 'Get most used templates' })
  @ApiResponse({ status: 200, description: 'Popular templates', type: [TemplateResponseDto] })
  getPopular(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.templatesService.getPopularTemplates(userId, parseInt(limit || '5'));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template by ID' })
  @ApiResponse({ status: 200, description: 'Template details', type: TemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templatesService.findOne(userId, id);
  }

  @Post(':id/use')
  @ApiOperation({
    summary: 'Use template (get rendered message for blast)',
    description: 'Returns the rendered message with variables replaced. Also increments usage count.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        variableValues: {
          type: 'object',
          example: { name: 'John', product: 'Laptop' },
          description: 'Values to replace variables in message',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Rendered template',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        mediaUrl: { type: 'string' },
        mediaType: { type: 'string', enum: ['image', 'video', 'audio', 'document'] },
      },
    },
  })
  useTemplate(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('variableValues') variableValues?: Record<string, string>,
  ) {
    return this.templatesService.getTemplateForBlast(userId, id, variableValues);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('mediaFile'))
  @ApiOperation({ summary: 'Update template' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiResponse({ status: 200, description: 'Template updated', type: TemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @UploadedFile() mediaFile?: Express.Multer.File,
  ) {
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    try {
      if (mediaFile) {
        mediaType = this.uploadsService.validateMediaFile(mediaFile);
        mediaUrl = await this.uploadsService.moveToUserDirectory(
          mediaFile.path,
          userId,
          'media',
          mediaFile.originalname,
        );
      }

      return this.templatesService.update(userId, id, updateTemplateDto, mediaUrl, mediaType);
    } catch (error) {
      if (mediaFile?.path) {
        this.uploadsService.cleanupTempFile(mediaFile.path);
      }
      if (mediaUrl) {
        this.uploadsService.cleanupTempFile(mediaUrl);
      }
      throw error;
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete template' })
  @ApiResponse({ status: 200, description: 'Template deleted' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.templatesService.remove(userId, id);
    return { message: 'Template deleted successfully' };
  }

  @Delete(':id/media')
  @ApiOperation({ summary: 'Remove media from template' })
  @ApiResponse({ status: 200, description: 'Media removed', type: TemplateResponseDto })
  removeMedia(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templatesService.removeMedia(userId, id);
  }
}
