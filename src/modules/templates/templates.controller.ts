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
  @UseInterceptors(FileInterceptor('imageFile'))
  @ApiOperation({
    summary: 'Create a new template',
    description: 'Create a blast message template. Optionally include an image.',
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
        imageFile: {
          type: 'string',
          format: 'binary',
          description: 'Optional image attachment',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Template created', type: TemplateResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() createTemplateDto: CreateTemplateDto,
    @UploadedFile() imageFile?: Express.Multer.File,
  ) {
    let imageUrl: string | undefined;

    try {
      if (imageFile) {
        this.uploadsService.validateImageFile(imageFile);
        imageUrl = await this.uploadsService.moveToUserDirectory(
          imageFile.path,
          userId,
          'images',
        );
      }

      return this.templatesService.create(userId, createTemplateDto, imageUrl);
    } catch (error) {
      // Cleanup on error
      if (imageFile?.path) {
        this.uploadsService.cleanupTempFile(imageFile.path);
      }
      if (imageUrl) {
        this.uploadsService.cleanupTempFile(imageUrl);
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
        imageUrl: { type: 'string' },
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
  @UseInterceptors(FileInterceptor('imageFile'))
  @ApiOperation({ summary: 'Update template' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiResponse({ status: 200, description: 'Template updated', type: TemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @UploadedFile() imageFile?: Express.Multer.File,
  ) {
    let imageUrl: string | undefined;

    try {
      if (imageFile) {
        this.uploadsService.validateImageFile(imageFile);
        imageUrl = await this.uploadsService.moveToUserDirectory(
          imageFile.path,
          userId,
          'images',
        );
      }

      return this.templatesService.update(userId, id, updateTemplateDto, imageUrl);
    } catch (error) {
      if (imageFile?.path) {
        this.uploadsService.cleanupTempFile(imageFile.path);
      }
      if (imageUrl) {
        this.uploadsService.cleanupTempFile(imageUrl);
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

  @Delete(':id/image')
  @ApiOperation({ summary: 'Remove image from template' })
  @ApiResponse({ status: 200, description: 'Image removed', type: TemplateResponseDto })
  removeImage(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templatesService.removeImage(userId, id);
  }
}
