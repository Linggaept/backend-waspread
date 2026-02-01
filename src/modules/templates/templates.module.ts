import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { Template } from '../../database/entities/template.entity';
import { UploadsModule } from '../uploads';

@Module({
  imports: [TypeOrmModule.forFeature([Template]), UploadsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
