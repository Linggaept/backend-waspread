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
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { StorageService } from '../uploads/storage.service';
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto';

@ApiTags('Products')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new product' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiResponse({ status: 201, description: 'Product created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const upload = await this.storageService.uploadFile(file, 'products');
      dto.imageUrl = upload.url;
    }
    return this.productsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products' })
  @ApiResponse({ status: 200, description: 'List of products' })
  findAll(@CurrentUser('id') userId: string, @Query() query: ProductQueryDto) {
    return this.productsService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a product' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiResponse({ status: 200, description: 'Product updated' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const upload = await this.storageService.uploadFile(file, 'products');
      dto.imageUrl = upload.url;
    }
    return this.productsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  delete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.delete(userId, id);
  }
}
