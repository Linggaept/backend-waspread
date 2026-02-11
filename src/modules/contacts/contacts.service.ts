import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Contact } from '../../database/entities/contact.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { WhatsAppSession } from '../../database/entities/whatsapp-session.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
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
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(WhatsAppSession)
    private readonly sessionRepository: Repository<WhatsAppSession>,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  async create(
    userId: string,
    createContactDto: CreateContactDto,
  ): Promise<Contact> {
    const phoneNumber = this.formatPhoneNumber(createContactDto.phoneNumber);

    // Check for duplicate
    const existing = await this.contactRepository.findOne({
      where: { userId, phoneNumber },
    });

    if (existing) {
      throw new ConflictException(
        `Contact with phone number ${phoneNumber} already exists`,
      );
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
      qb.andWhere('contact.tags @> :tags', {
        tags: JSON.stringify([query.tag]),
      });
    }

    if (query.source) {
      qb.andWhere('contact.source = :source', { source: query.source });
    }

    if (query.isWaContact !== undefined) {
      qb.andWhere('contact.isWaContact = :isWaContact', {
        isWaContact: query.isWaContact,
      });
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

  async findByPhoneNumber(
    userId: string,
    phoneNumber: string,
  ): Promise<Contact | null> {
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
        throw new ConflictException(
          `Contact with phone number ${newPhone} already exists`,
        );
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

  async bulkRemove(
    userId: string,
    ids: string[],
  ): Promise<{ deleted: number }> {
    const result = await this.contactRepository
      .createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('id IN (:...ids)', { ids })
      .execute();

    return { deleted: result.affected || 0 };
  }

  async getAllPhoneNumbers(
    userId: string,
    activeOnly = true,
  ): Promise<string[]> {
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

  /**
   * Get phone numbers by source (whatsapp, manual, import)
   */
  async getPhoneNumbersBySource(
    userId: string,
    source: string,
  ): Promise<string[]> {
    const contacts = await this.contactRepository.find({
      where: { userId, source, isActive: true },
      select: ['phoneNumber'],
    });

    return contacts.map((c) => c.phoneNumber);
  }

  /**
   * Get phone numbers by contact IDs
   */
  async getPhoneNumbersByIds(
    userId: string,
    contactIds: string[],
  ): Promise<string[]> {
    const contacts = await this.contactRepository
      .createQueryBuilder('contact')
      .select('contact.phoneNumber')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.id IN (:...ids)', { ids: contactIds })
      .andWhere('contact.isActive = true')
      .getMany();

    return contacts.map((c) => c.phoneNumber);
  }

  /**
   * Get phone numbers - only WA verified contacts
   */
  async getPhoneNumbersWaVerified(userId: string): Promise<string[]> {
    const contacts = await this.contactRepository.find({
      where: { userId, isWaContact: true, isActive: true },
      select: ['phoneNumber'],
    });

    return contacts.map((c) => c.phoneNumber);
  }

  /**
   * Count contacts by various filters (for preview)
   */
  async countByFilter(
    userId: string,
    filter: {
      tag?: string;
      source?: string;
      contactIds?: string[];
      onlyWaVerified?: boolean;
    },
  ): Promise<number> {
    const qb = this.contactRepository
      .createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.isActive = true');

    if (filter.tag) {
      qb.andWhere('contact.tags @> :tags', {
        tags: JSON.stringify([filter.tag]),
      });
    }

    if (filter.source) {
      qb.andWhere('contact.source = :source', { source: filter.source });
    }

    if (filter.contactIds && filter.contactIds.length > 0) {
      qb.andWhere('contact.id IN (:...ids)', { ids: filter.contactIds });
    }

    if (filter.onlyWaVerified) {
      qb.andWhere('contact.isWaContact = true');
    }

    return qb.getCount();
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

  /**
   * Sync contacts from WhatsApp
   */
  async syncFromWhatsApp(
    userId: string,
    waContacts: Array<{
      phoneNumber: string;
      name: string | null;
      pushname: string | null;
      isMyContact: boolean;
      isWAContact: boolean;
    }>,
    options: { updateExisting?: boolean; onlyMyContacts?: boolean } = {},
  ): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    total: number;
  }> {
    const { updateExisting = true, onlyMyContacts = false } = options;

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // Filter jika hanya kontak yang tersimpan di HP
    const contactsToSync = onlyMyContacts
      ? waContacts.filter((c) => c.isMyContact)
      : waContacts;

    for (const waContact of contactsToSync) {
      try {
        const phoneNumber = this.formatPhoneNumber(waContact.phoneNumber);

        // Skip jika nomor tidak valid
        if (!phoneNumber || phoneNumber.length < 10) {
          skipped++;
          continue;
        }

        // Cek apakah sudah ada
        const existing = await this.contactRepository.findOne({
          where: { userId, phoneNumber },
        });

        if (existing) {
          if (updateExisting) {
            // Update info dari WhatsApp
            existing.waName =
              waContact.pushname || waContact.name || existing.waName;
            existing.isWaContact = waContact.isWAContact;
            existing.lastSyncedAt = new Date();

            // Update nama jika belum ada
            if (!existing.name && (waContact.name || waContact.pushname)) {
              existing.name = waContact.name || waContact.pushname || undefined;
            }

            // Add 'whatsapp' tag if not already present
            const currentTags = existing.tags || [];
            if (!currentTags.includes('whatsapp')) {
              existing.tags = [...currentTags, 'whatsapp'];
            }

            await this.contactRepository.save(existing);
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Create new contact
          const contact = this.contactRepository.create({
            userId,
            phoneNumber,
            name: waContact.name || waContact.pushname || undefined,
            waName: waContact.pushname || waContact.name || undefined,
            isWaContact: waContact.isWAContact,
            source: 'whatsapp',
            lastSyncedAt: new Date(),
            isActive: true,
            tags: ['whatsapp'],
          });

          await this.contactRepository.save(contact);
          imported++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync contact ${waContact.phoneNumber}: ${error}`,
        );
        skipped++;
      }
    }

    this.logger.log(
      `WhatsApp sync for user ${userId}: ${imported} imported, ${updated} updated, ${skipped} skipped`,
    );

    return {
      imported,
      updated,
      skipped,
      total: contactsToSync.length,
    };
  }

  /**
   * Get contacts synced from WhatsApp
   */
  async getWhatsAppSyncedContacts(userId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { userId, source: 'whatsapp' },
      order: { name: 'ASC' },
    });
  }

  /**
   * Comprehensive sync: contacts from WA contact store + chat conversations
   * This method gets contacts from both sources and merges them with pushNames
   */
  async syncAllContacts(
    userId: string,
    options: { updateExisting?: boolean } = {},
  ): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    total: number;
    fromWaContacts: number;
    fromChats: number;
  }> {
    const { updateExisting = true } = options;

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let fromWaContacts = 0;
    let fromChats = 0;

    // Get current session phone number
    const session = await this.sessionRepository.findOne({
      where: { userId },
    });

    if (!session?.phoneNumber) {
      this.logger.warn(`No active session found for user ${userId}`);
      return {
        imported,
        updated,
        skipped,
        total: 0,
        fromWaContacts,
        fromChats,
      };
    }

    const sessionPhoneNumber = session.phoneNumber;
    this.logger.log(`Syncing contacts for session ${sessionPhoneNumber}`);

    // 1. Get contacts from WhatsApp contact store
    const waContactsMap = new Map<
      string,
      {
        phoneNumber: string;
        name: string | null;
        pushname: string | null;
        isMyContact: boolean;
        isWAContact: boolean;
        source: 'wa_contacts' | 'chat';
      }
    >();

    try {
      const { contacts: waContacts } =
        await this.whatsappService.getWhatsAppContacts(userId);

      for (const contact of waContacts) {
        const phoneNumber = this.formatPhoneNumber(contact.phoneNumber);
        if (!phoneNumber || phoneNumber.length < 10) continue;

        waContactsMap.set(phoneNumber, {
          phoneNumber,
          name: contact.name,
          pushname: contact.pushname,
          isMyContact: contact.isMyContact,
          isWAContact: contact.isWAContact,
          source: 'wa_contacts',
        });
        fromWaContacts++;
      }

      this.logger.log(`Got ${fromWaContacts} contacts from WA contact store`);
    } catch (error) {
      this.logger.warn(`Failed to get WA contacts: ${error}`);
    }

    // 2. Get unique phone numbers from chat conversations (for current session)
    const chatPhoneNumbers = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('DISTINCT msg.phoneNumber', 'phoneNumber')
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.sessionPhoneNumber = :sessionPhoneNumber', {
        sessionPhoneNumber,
      })
      .andWhere('msg.phoneNumber IS NOT NULL')
      .andWhere("msg.phoneNumber != ''")
      .getRawMany();

    this.logger.log(
      `Found ${chatPhoneNumbers.length} unique phone numbers from chat history`,
    );

    // Get pushNames for chat contacts that aren't in WA contacts
    const chatOnlyPhones: string[] = [];
    for (const { phoneNumber: rawPhone } of chatPhoneNumbers) {
      const formatted = this.formatPhoneNumber(rawPhone);
      if (!formatted || formatted.length < 10) continue;

      if (!waContactsMap.has(formatted)) {
        chatOnlyPhones.push(formatted);
      }
    }

    // Get pushNames from WhatsApp for chat-only contacts
    let pushNameMap: Record<string, string | null> = {};
    if (chatOnlyPhones.length > 0) {
      try {
        pushNameMap = await this.whatsappService.getContactsPushNames(
          userId,
          chatOnlyPhones,
        );
      } catch (error) {
        this.logger.warn(`Failed to get pushNames: ${error}`);
      }
    }

    // Add chat-only contacts to the map
    for (const phoneNumber of chatOnlyPhones) {
      if (!waContactsMap.has(phoneNumber)) {
        waContactsMap.set(phoneNumber, {
          phoneNumber,
          name: null,
          pushname: pushNameMap[phoneNumber] || null,
          isMyContact: false,
          isWAContact: true, // They have chat history, so they're on WA
          source: 'chat',
        });
        fromChats++;
      }
    }

    this.logger.log(`Got ${fromChats} additional contacts from chat history`);

    // 3. Save all contacts to database
    for (const [phoneNumber, contactData] of waContactsMap) {
      try {
        const existing = await this.contactRepository.findOne({
          where: { userId, phoneNumber },
        });

        if (existing) {
          if (updateExisting) {
            // Update with WA info
            const newWaName =
              contactData.pushname || contactData.name || existing.waName;
            if (newWaName) existing.waName = newWaName;

            existing.isWaContact = contactData.isWAContact;
            existing.lastSyncedAt = new Date();

            // Update name if not set
            if (!existing.name && (contactData.name || contactData.pushname)) {
              existing.name =
                contactData.name || contactData.pushname || undefined;
            }

            // Add source tag
            const currentTags = existing.tags || [];
            const sourceTag =
              contactData.source === 'wa_contacts' ? 'whatsapp' : 'chat';
            if (!currentTags.includes(sourceTag)) {
              existing.tags = [...currentTags, sourceTag];
            }

            await this.contactRepository.save(existing);
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Create new contact
          const sourceTag =
            contactData.source === 'wa_contacts' ? 'whatsapp' : 'chat';
          const contact = this.contactRepository.create({
            userId,
            phoneNumber,
            name: contactData.name || contactData.pushname || undefined,
            waName: contactData.pushname || contactData.name || undefined,
            isWaContact: contactData.isWAContact,
            source: contactData.source === 'wa_contacts' ? 'whatsapp' : 'chat',
            lastSyncedAt: new Date(),
            isActive: true,
            tags: [sourceTag],
          });

          await this.contactRepository.save(contact);
          imported++;
        }
      } catch (error) {
        this.logger.error(`Failed to sync contact ${phoneNumber}: ${error}`);
        skipped++;
      }
    }

    const total = waContactsMap.size;
    this.logger.log(
      `Contact sync for user ${userId}: ${imported} imported, ${updated} updated, ${skipped} skipped (total: ${total}, WA: ${fromWaContacts}, chats: ${fromChats})`,
    );

    return {
      imported,
      updated,
      skipped,
      total,
      fromWaContacts,
      fromChats,
    };
  }

  /**
   * Get session phone number for current user
   */
  async getSessionPhoneNumber(userId: string): Promise<string | null> {
    const session = await this.sessionRepository.findOne({
      where: { userId },
    });
    return session?.phoneNumber || null;
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
