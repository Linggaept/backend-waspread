import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
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
    const existing = await this.packageRepository.findOne({ where: { name: freePackageName } });

    if (!existing) {
      this.logger.log('Seeding Free Trial package...');
      const pkg = this.packageRepository.create({
        name: freePackageName,
        description: 'Paket uji coba gratis untuk pengguna baru',
        price: 0,
        durationDays: 3,
        monthlyQuota: 50,
        dailyLimit: 20,
        isActive: true,
        sortOrder: 0,
      });
      await this.packageRepository.save(pkg);
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

  async update(id: string, updatePackageDto: UpdatePackageDto): Promise<Package> {
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
}
