import { Module } from '@nestjs/common';
import { CopywritingController } from './copywriting.controller';
import { CopywritingService } from './copywriting.service';

@Module({
  controllers: [CopywritingController],
  providers: [CopywritingService],
})
export class CopywritingModule {}
