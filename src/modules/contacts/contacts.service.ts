import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Contact } from '../../database/entities/contact.entity';
import {
  CreateContactDto,
  UpdateContactDto,
  ContactQueryDto,
  ImportResultDto,
} from './dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async create(userId: string, createContactDto: CreateContactDto): Promise<Contact> {
    const phoneNumber = this.formatPhoneNumber(createContactDto.phoneNumber);

    // Check for duplicate
    const existing = await this.contactRepository.findOne({
      where: { userId, phoneNumber },
    });

    if (existing) {
      throw new ConflictException(`Contact with phone number ${phoneNumber} already exists`);
    }

    const contact = this.contactRepository.create({
      userId,
      phoneNumber,
      name: createContactDto.name,
      email: createContactDto.email,
      notes: createContactDto.notes,
      tags: createContactDto.tags,
    });

    return this.contactRepository.save(contact);
  }

  async bulkCreate(
    userId: string,
    contacts: CreateContactDto[],
    skipDuplicates = true,
  ): Promise<ImportResultDto> {
    const result: ImportResultDto = {
      totalProcessed: contacts.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const contactDto of contacts) {
      try {
        const phoneNumber = this.formatPhoneNumber(contactDto.phoneNumber);

        // Check for duplicate
        const existing = await this.contactRepository.findOne({
          where: { userId, phoneNumber },
        });

        if (existing) {
          if (skipDuplicates) {
            result.skipped++;
            continue;
          } else {
            throw new Error(`Duplicate phone number: ${phoneNumber}`);
          }
        }

        const contact = this.contactRepository.create({
          userId,
          phoneNumber,
          name: contactDto.name,
          email: contactDto.email,
          notes: contactDto.notes,
          tags: contactDto.tags,
        });

        await this.contactRepository.save(contact);
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors?.push(`${contactDto.phoneNumber}: ${error.message}`);
      }
    }

    this.logger.log(
      `Import completed for user ${userId}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`,
    );

    return result;
  }

  async findAll(
    userId: string,
    query: ContactQueryDto,
  ): Promise<{ data: Contact[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.contactRepository.createQueryBuilder('contact');
    qb.where('contact.userId = :userId', { userId });

    if (query.search) {
      qb.andWhere(
        '(contact.name ILIKE :search OR contact.phoneNumber ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.tag) {
      qb.andWhere('contact.tags @> :tags', { tags: JSON.stringify([query.tag]) });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('contact.isActive = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('contact.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(userId: string, id: string): Promise<Contact> {
    const contact = await this.contactRepository.findOne({
      where: { id, userId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    return contact;
  }

  async findByPhoneNumber(userId: string, phoneNumber: string): Promise<Contact | null> {
    const formatted = this.formatPhoneNumber(phoneNumber);
    return this.contactRepository.findOne({
      where: { userId, phoneNumber: formatted },
    });
  }

  async update(
    userId: string,
    id: string,
    updateContactDto: UpdateContactDto,
  ): Promise<Contact> {
    const contact = await this.findOne(userId, id);

    if (updateContactDto.phoneNumber) {
      const newPhone = this.formatPhoneNumber(updateContactDto.phoneNumber);

      // Check if new phone number already exists (for different contact)
      const existing = await this.contactRepository.findOne({
        where: { userId, phoneNumber: newPhone },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(`Contact with phone number ${newPhone} already exists`);
      }

      updateContactDto.phoneNumber = newPhone;
    }

    Object.assign(contact, updateContactDto);
    return this.contactRepository.save(contact);
  }

  async remove(userId: string, id: string): Promise<void> {
    const contact = await this.findOne(userId, id);
    await this.contactRepository.remove(contact);
  }

  async bulkRemove(userId: string, ids: string[]): Promise<{ deleted: number }> {
    const result = await this.contactRepository
      .createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('id IN (:...ids)', { ids })
      .execute();

    return { deleted: result.affected || 0 };
  }

  async getAllPhoneNumbers(userId: string, activeOnly = true): Promise<string[]> {
    const qb = this.contactRepository
      .createQueryBuilder('contact')
      .select('contact.phoneNumber')
      .where('contact.userId = :userId', { userId });

    if (activeOnly) {
      qb.andWhere('contact.isActive = true');
    }

    const contacts = await qb.getMany();
    return contacts.map((c) => c.phoneNumber);
  }

  async getPhoneNumbersByTag(userId: string, tag: string): Promise<string[]> {
    const contacts = await this.contactRepository
      .createQueryBuilder('contact')
      .select('contact.phoneNumber')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.isActive = true')
      .andWhere('contact.tags @> :tags', { tags: JSON.stringify([tag]) })
      .getMany();

    return contacts.map((c) => c.phoneNumber);
  }

  async getTags(userId: string): Promise<string[]> {
    const result = await this.contactRepository
      .createQueryBuilder('contact')
      .select('DISTINCT jsonb_array_elements_text(contact.tags)', 'tag')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.tags IS NOT NULL')
      .getRawMany();

    return result.map((r) => r.tag).filter(Boolean);
  }

  async getStats(userId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    withTags: number;
  }> {
    const total = await this.contactRepository.count({ where: { userId } });
    const active = await this.contactRepository.count({
      where: { userId, isActive: true },
    });
    const withTags = await this.contactRepository
      .createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.tags IS NOT NULL')
      .andWhere("contact.tags != '[]'::jsonb")
      .getCount();

    return {
      total,
      active,
      inactive: total - active,
      withTags,
    };
  }

  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters (handles +, -, (), spaces, dots, quotes, etc.)
    let cleaned = phone.replace(/\D/g, '');

    // Handle various prefix formats:
    // 0062... (international with 00) -> 62...
    if (cleaned.startsWith('0062')) {
      cleaned = cleaned.substring(2);
    }
    // 620... (e.g., from "62-0821" or "+62 0821") -> remove extra 0 after 62
    else if (cleaned.startsWith('620')) {
      cleaned = '62' + cleaned.substring(3);
    }
    // 0... (local format) -> 62...
    else if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    // Already starts with 62 (without extra 0) -> keep as is

    return cleaned;
  }
}
