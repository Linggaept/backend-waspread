import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BlastsService } from './blasts.service';
import { CreateBlastDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('blasts')
@UseGuards(JwtAuthGuard)
export class BlastsController {
  constructor(private readonly blastsService: BlastsService) {}

  // Create blast campaign
  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() createBlastDto: CreateBlastDto,
  ) {
    return this.blastsService.create(userId, createBlastDto);
  }

  // Start blast
  @Post(':id/start')
  startBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.startBlast(userId, id);
  }

  // Cancel blast
  @Post(':id/cancel')
  cancelBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.cancelBlast(userId, id);
  }

  // Get all user's blasts
  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.blastsService.findAll(userId);
  }

  // Get user's blast stats
  @Get('stats')
  getStats(@CurrentUser('id') userId: string) {
    return this.blastsService.getStats(userId);
  }

  // Get blast by ID
  @Get(':id')
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.findOne(userId, id);
  }

  // Get blast with messages
  @Get(':id/messages')
  findOneWithMessages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blastsService.findOneWithMessages(userId, id);
  }

  // Admin: Get all blasts
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findAllAdmin() {
    return this.blastsService.findAllAdmin();
  }
}
