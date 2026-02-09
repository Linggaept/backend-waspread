import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PackagesService } from './packages.service';
import { CreatePackageDto, UpdatePackageDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Packages')
@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active packages (Public)' })
  @ApiResponse({ status: 200, description: 'List of active packages' })
  findActive() {
    return this.packagesService.findActive();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create new package (Admin)' })
  @ApiResponse({ status: 201, description: 'Package created successfully' })
  create(@Body() createPackageDto: CreatePackageDto) {
    return this.packagesService.create(createPackageDto);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all packages including inactive (Admin)' })
  @ApiResponse({ status: 200, description: 'List of all packages' })
  findAll() {
    return this.packagesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get package by ID' })
  @ApiResponse({ status: 200, description: 'Package details' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update package (Admin)' })
  @ApiResponse({ status: 200, description: 'Package updated successfully' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePackageDto: UpdatePackageDto,
  ) {
    return this.packagesService.update(id, updatePackageDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete package (Admin)' })
  @ApiResponse({ status: 200, description: 'Package deleted successfully' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.remove(id);
  }

  @Patch(':id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Toggle package active status (Admin)' })
  @ApiResponse({ status: 200, description: 'Package status toggled' })
  toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.toggleActive(id);
  }

  @Patch(':id/toggle-purchasable')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Toggle package purchasable status (Admin)' })
  @ApiResponse({
    status: 200,
    description: 'Package purchasable status toggled',
  })
  togglePurchasable(@Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.togglePurchasable(id);
  }
}
