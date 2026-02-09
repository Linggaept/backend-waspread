import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto';

@ApiTags('Settings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user settings' })
  @ApiResponse({
    status: 200,
    description: 'User settings',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        notificationSound: { type: 'boolean' },
        notificationDesktop: { type: 'boolean' },
        language: { type: 'string', nullable: true },
      },
    },
  })
  async getSettings(@CurrentUser('id') userId: string) {
    return this.settingsService.getSettings(userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update user settings' })
  @ApiBody({ type: UpdateSettingsDto })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(userId, dto);
  }
}
