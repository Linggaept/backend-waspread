import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BlastsService } from './blasts.service';
import { CreateBlastDto, BlastResponseDto, BlastDetailDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Blasts')
@ApiBearerAuth('JWT-auth')
@Controller('blasts')
@UseGuards(JwtAuthGuard)
export class BlastsController {
  constructor(private readonly blastsService: BlastsService) {}

  @Post()
  @ApiOperation({ summary: 'Create blast campaign' })
  @ApiResponse({ status: 201, description: 'Blast created successfully', type: BlastResponseDto })
  create(
    @CurrentUser('id') userId: string,
    @Body() createBlastDto: CreateBlastDto,
  ) {
    return this.blastsService.create(userId, createBlastDto);
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
  @ApiOperation({ summary: 'Get all user blasts' })
  @ApiResponse({ status: 200, description: 'List of blasts', type: [BlastResponseDto] })
  findAll(@CurrentUser('id') userId: string) {
    return this.blastsService.findAll(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get blast statistics' })
  @ApiResponse({ status: 200, description: 'User blast statistics' })
  getStats(@CurrentUser('id') userId: string) {
    return this.blastsService.getStats(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blast details' })
  @ApiResponse({ status: 200, description: 'Blast details', type: BlastResponseDto })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.findOne(userId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get blast with message details' })
  @ApiResponse({ status: 200, description: 'Blast details with messages', type: BlastDetailDto })
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
