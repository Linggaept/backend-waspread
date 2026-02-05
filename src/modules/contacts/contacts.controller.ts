import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContactsService } from './contacts.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import {
  CreateContactDto,
  UpdateContactDto,
  ImportContactsDto,
  ContactResponseDto,
  ImportResultDto,
  ContactQueryDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UploadsService } from '../uploads/uploads.service';

@ApiTags('Contacts')
@ApiBearerAuth('JWT-auth')
@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly uploadsService: UploadsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new contact' })
  @ApiResponse({
    status: 201,
    description: 'Contact created',
    type: ContactResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Contact already exists' })
  create(
    @CurrentUser('id') userId: string,
    @Body() createContactDto: CreateContactDto,
  ) {
    return this.contactsService.create(userId, createContactDto);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Import contacts from CSV/Excel file',
    description:
      'Import contacts from a CSV or Excel file. First column should be phone number. Optional columns: name, email, notes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV/Excel file with contacts',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags to apply to all imported contacts',
          example: 'customer,promo',
        },
        skipDuplicates: {
          type: 'boolean',
          description: 'Skip duplicate phone numbers instead of failing',
          default: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Import completed',
    type: ImportResultDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async import(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() importDto: ImportContactsDto,
  ): Promise<ImportResultDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    try {
      this.uploadsService.validatePhoneFile(file);
      const contacts = await this.parseContactsFile(file.path, importDto.tags);

      if (contacts.length === 0) {
        throw new BadRequestException('No valid contacts found in file');
      }

      const result = await this.contactsService.bulkCreate(
        userId,
        contacts,
        importDto.skipDuplicates ?? true,
      );

      return result;
    } finally {
      // Cleanup temp file
      this.uploadsService.cleanupTempFile(file.path);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all contacts with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'List of contacts' })
  findAll(@CurrentUser('id') userId: string, @Query() query: ContactQueryDto) {
    return this.contactsService.findAll(userId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get contact statistics' })
  @ApiResponse({ status: 200, description: 'Contact statistics' })
  getStats(@CurrentUser('id') userId: string) {
    return this.contactsService.getStats(userId);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Get all unique tags' })
  @ApiResponse({ status: 200, description: 'List of tags', type: [String] })
  getTags(@CurrentUser('id') userId: string) {
    return this.contactsService.getTags(userId);
  }

  @Get('phone-numbers')
  @ApiOperation({ summary: 'Get all phone numbers (for blast campaigns)' })
  @ApiResponse({
    status: 200,
    description: 'List of phone numbers',
    type: [String],
  })
  getPhoneNumbers(
    @CurrentUser('id') userId: string,
    @Query('tag') tag?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    if (tag) {
      return this.contactsService.getPhoneNumbersByTag(userId, tag);
    }
    return this.contactsService.getAllPhoneNumbers(
      userId,
      activeOnly !== 'false',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by ID' })
  @ApiResponse({
    status: 200,
    description: 'Contact details',
    type: ContactResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contactsService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update contact' })
  @ApiResponse({
    status: 200,
    description: 'Contact updated',
    type: ContactResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateContactDto: UpdateContactDto,
  ) {
    return this.contactsService.update(userId, id, updateContactDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete contact' })
  @ApiResponse({ status: 200, description: 'Contact deleted' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.contactsService.remove(userId, id);
    return { message: 'Contact deleted successfully' };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk delete contacts' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of contact IDs to delete',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Contacts deleted' })
  async bulkRemove(
    @CurrentUser('id') userId: string,
    @Body('ids') ids: string[],
  ) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException('No contact IDs provided');
    }
    return this.contactsService.bulkRemove(userId, ids);
  }

  private async parseContactsFile(
    filePath: string,
    tags?: string[],
  ): Promise<CreateContactDto[]> {
    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheet = workbook.getWorksheet(1);
    if (!sheet) return [];

    const contacts: CreateContactDto[] = [];
    const seenPhones = new Set<string>(); // Prevent duplicates within file

    // Get headers for name/email/notes detection
    const firstRowValues = sheet.getRow(1).values;
    let headers: string[] = [];

    if (Array.isArray(firstRowValues)) {
      headers = (firstRowValues as any[]).slice(1).map((h) =>
        String(h || '')
          .toLowerCase()
          .trim(),
      );
    } else if (typeof firstRowValues === 'object') {
      headers = Object.values(firstRowValues).map((h) =>
        String(h || '')
          .toLowerCase()
          .trim(),
      );
    }

    // Detect columns for optional fields
    const nameColIdx = this.findColumn(headers, [
      'name',
      'nama',
      'fullname',
      'full_name',
    ]);
    const emailColIdx = this.findColumn(headers, ['email', 'e-mail', 'mail']);
    const notesColIdx = this.findColumn(headers, [
      'notes',
      'note',
      'catatan',
      'keterangan',
    ]);

    // Check if first row looks like a header (contains known header words)
    const hasHeader = this.rowLooksLikeHeader(headers);

    sheet.eachRow((row, rowNumber) => {
      // Skip header row if detected
      if (rowNumber === 1 && hasHeader) return;

      // Scan ALL cells in this row to find phone numbers
      const phoneNumbers: string[] = [];
      let nameVal: string | undefined;
      let emailVal: string | undefined;
      let notesVal: string | undefined;

      row.eachCell((cell, colNumber) => {
        const cellValue = String(cell.value || '').trim();
        if (!cellValue) return;

        // Try to extract phone number from this cell
        const extractedPhone = this.extractPhoneNumber(cellValue);
        if (extractedPhone) {
          phoneNumbers.push(extractedPhone);
        }

        // Also check for name/email/notes by column index (if headers detected)
        const colIdx = colNumber - 1; // Convert to 0-based
        if (
          nameColIdx !== null &&
          colIdx === nameColIdx &&
          !this.looksLikePhone(cellValue)
        ) {
          nameVal = cellValue;
        }
        if (emailColIdx !== null && colIdx === emailColIdx) {
          emailVal = cellValue;
        }
        if (
          notesColIdx !== null &&
          colIdx === notesColIdx &&
          !this.looksLikePhone(cellValue)
        ) {
          notesVal = cellValue;
        }
      });

      // Use the first valid phone number found in the row
      if (phoneNumbers.length > 0) {
        const phone = phoneNumbers[0];

        // Skip if already seen in this file
        if (seenPhones.has(phone)) return;
        seenPhones.add(phone);

        const contact: CreateContactDto = {
          phoneNumber: phone,
        };

        if (nameVal) contact.name = nameVal;
        if (emailVal) contact.email = emailVal;
        if (notesVal) contact.notes = notesVal;
        if (tags && tags.length > 0) contact.tags = tags;

        contacts.push(contact);
      }
    });

    return contacts;
  }

  /**
   * Extract phone number from a cell value using pattern matching.
   * Handles formats like: 0821-3789-02, +62 821 3789 02, (62)821378902, etc.
   */
  private extractPhoneNumber(value: string): string | null {
    // Remove all non-digit characters first
    const digitsOnly = value.replace(/\D/g, '');

    // Must have between 10-25 digits to be a valid phone
    if (digitsOnly.length < 10 || digitsOnly.length > 25) {
      return null;
    }

    // Format the phone number (normalize to 62xxx format)
    return this.formatPhoneNumber(digitsOnly);
  }

  /**
   * Format phone number to standard 62xxx format
   */
  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    // 0062... -> 62...
    if (cleaned.startsWith('0062')) {
      cleaned = cleaned.substring(2);
    }
    // 620... (e.g., from "62-0821") -> remove extra 0 after 62
    else if (cleaned.startsWith('620')) {
      cleaned = '62' + cleaned.substring(3);
    }
    // 0... -> 62...
    else if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }

    return cleaned;
  }

  /**
   * Check if a value looks like a phone number (has enough digits)
   */
  private looksLikePhone(value: string): boolean {
    const digitsOnly = value.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 25;
  }

  /**
   * Check if the row looks like a header row
   */
  private rowLooksLikeHeader(headers: string[]): boolean {
    const headerKeywords = [
      'phone',
      'phoneNumber',
      'phone_number',
      'nomor',
      'no',
      'hp',
      'whatsapp',
      'wa',
      'mobile',
      'telepon',
      'handphone',
      'name',
      'nama',
      'fullname',
      'full_name',
      'email',
      'e-mail',
      'mail',
      'notes',
      'note',
      'catatan',
      'keterangan',
    ];

    return headers.some((h) => headerKeywords.includes(h.toLowerCase()));
  }

  private findColumn(
    headers: string[],
    possibleNames: string[],
  ): number | null {
    for (const name of possibleNames) {
      const index = headers.findIndex((h) => h === name.toLowerCase());
      if (index !== -1) return index;
    }
    return null;
  }
}
