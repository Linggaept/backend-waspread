import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserSettings,
  ThemeMode,
} from '../../database/entities/user-settings.entity';
import { UpdateSettingsDto } from './dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(UserSettings)
    private readonly settingsRepository: Repository<UserSettings>,
  ) {}

  /**
   * Get user settings (create default if not exists)
   */
  async getSettings(userId: string): Promise<UserSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      // Create default settings
      settings = this.settingsRepository.create({
        userId,
        theme: ThemeMode.SYSTEM,
        notificationSound: true,
        notificationDesktop: true,
      });
      await this.settingsRepository.save(settings);
      this.logger.log(`Created default settings for user ${userId}`);
    }

    return settings;
  }

  /**
   * Update user settings
   */
  async updateSettings(
    userId: string,
    dto: UpdateSettingsDto,
  ): Promise<UserSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      // Create with provided values
      settings = this.settingsRepository.create({
        userId,
        theme: dto.theme ?? ThemeMode.SYSTEM,
        notificationSound: dto.notificationSound ?? true,
        notificationDesktop: dto.notificationDesktop ?? true,
        language: dto.language,
      });
    } else {
      // Update existing
      if (dto.theme !== undefined) settings.theme = dto.theme;
      if (dto.notificationSound !== undefined)
        settings.notificationSound = dto.notificationSound;
      if (dto.notificationDesktop !== undefined)
        settings.notificationDesktop = dto.notificationDesktop;
      if (dto.language !== undefined) settings.language = dto.language;
    }

    await this.settingsRepository.save(settings);
    this.logger.log(`Updated settings for user ${userId}`);

    return settings;
  }

  /**
   * Update theme only (shortcut)
   */
  async updateTheme(userId: string, theme: ThemeMode): Promise<UserSettings> {
    return this.updateSettings(userId, { theme });
  }
}
