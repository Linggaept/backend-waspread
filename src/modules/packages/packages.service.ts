import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package } from '../../database/entities/package.entity';
import { CreatePackageDto, UpdatePackageDto } from './dto';

@Injectable()
export class PackagesService implements OnModuleInit {
  private readonly logger = new Logger(PackagesService.name);
  constructor(
    @InjectRepository(Package)
    private readonly packageRepository: Repository<Package>,
  ) {}

  async onModuleInit() {
    await this.seedFreeTrialPackage();
  }

  private async seedFreeTrialPackage() {
    const freePackageName = 'Free Trial';
    const existing = await this.packageRepository.findOne({
      where: { name: freePackageName },
    });

    if (!existing) {
      this.logger.log('Seeding Free Trial package...');
      const pkg = this.packageRepository.create({
        name: freePackageName,
        description: 'Paket uji coba gratis untuk pengguna baru',
        price: 0,
        durationDays: 3,
        // Blast quota (recipients)
        blastMonthlyQuota: 50, // Max 50 recipients per month
        blastDailyLimit: 20, // Max 20 recipients per day
        isActive: true,
        isPurchasable: false, // Free Trial tampil tapi tidak bisa dibeli
        sortOrder: 0,
        // AI quota
        aiQuota: 10, // Limited AI quota for trial
        // Feature flags
        hasAnalytics: false, // No analytics in free
        hasAiFeatures: true, // Allow AI with quota
        hasLeadScoring: false, // No lead scoring in free
      });
      await this.packageRepository.save(pkg);
    } else {
      // Update existing Free Trial with new feature flags if not set
      let needsUpdate = false;

      if (existing.isPurchasable !== false) {
        existing.isPurchasable = false;
        needsUpdate = true;
      }

      // Update feature flags if they have default values (meaning not yet configured)
      if (existing.aiQuota === 0) {
        existing.aiQuota = 10;
        needsUpdate = true;
      }
      if (existing.hasAnalytics === true) {
        existing.hasAnalytics = false;
        needsUpdate = true;
      }
      if (existing.hasLeadScoring === true) {
        existing.hasLeadScoring = false;
        needsUpdate = true;
      }
      if (existing.blastDailyLimit === 0) {
        existing.blastDailyLimit = 2;
        needsUpdate = true;
      }
      if (existing.blastMonthlyQuota === 0) {
        existing.blastMonthlyQuota = 10;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await this.packageRepository.save(existing);
        this.logger.log('Updated Free Trial package with feature flags');
      }
    }
  }

  async create(createPackageDto: CreatePackageDto): Promise<Package> {
    const pkg = this.packageRepository.create(createPackageDto);
    return this.packageRepository.save(pkg);
  }

  async findAll(): Promise<Package[]> {
    return this.packageRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async findActive(): Promise<Package[]> {
    return this.packageRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Package> {
    const pkg = await this.packageRepository.findOne({ where: { id } });
    if (!pkg) {
      throw new NotFoundException(`Package with ID ${id} not found`);
    }
    return pkg;
  }

  async update(
    id: string,
    updatePackageDto: UpdatePackageDto,
  ): Promise<Package> {
    const pkg = await this.findOne(id);
    Object.assign(pkg, updatePackageDto);
    return this.packageRepository.save(pkg);
  }

  async remove(id: string): Promise<void> {
    const pkg = await this.findOne(id);
    await this.packageRepository.remove(pkg);
  }

  async toggleActive(id: string): Promise<Package> {
    const pkg = await this.findOne(id);
    pkg.isActive = !pkg.isActive;
    return this.packageRepository.save(pkg);
  }

  async togglePurchasable(id: string): Promise<Package> {
    const pkg = await this.findOne(id);
    pkg.isPurchasable = !pkg.isPurchasable;
    return this.packageRepository.save(pkg);
  }
}
