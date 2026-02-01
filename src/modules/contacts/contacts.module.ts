import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { Contact } from '../../database/entities/contact.entity';
import { UploadsModule } from '../uploads';

@Module({
  imports: [TypeOrmModule.forFeature([Contact]), UploadsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
