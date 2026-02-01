import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

export interface ParsedPhoneNumbers {
  phoneNumbers: string[];
  totalParsed: number;
  invalidCount: number;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');
  private readonly tempDir = path.join(this.uploadsDir, 'temp');
  private readonly imagesDir = path.join(this.uploadsDir, 'images');

  private readonly ALLOWED_PHONE_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];
  private readonly MAX_PHONE_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.uploadsDir, this.tempDir, this.imagesDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  parsePhoneNumbersFile(filePath: string): ParsedPhoneNumbers {
    const ext = path.extname(filePath).toLowerCase();

    if (!this.ALLOWED_PHONE_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file format. Allowed: ${this.ALLOWED_PHONE_EXTENSIONS.join(', ')}`,
      );
    }

    const stats = fs.statSync(filePath);
    if (stats.size > this.MAX_PHONE_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size: ${this.MAX_PHONE_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert to array of arrays
      const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
      });

      if (!data || data.length === 0) {
        throw new BadRequestException('File is empty');
      }

      const phoneNumbers: string[] = [];
      let invalidCount = 0;

      // Check if first row looks like a header
      const firstRow = data[0];
      const startIndex = this.isHeaderRow(firstRow) ? 1 : 0;

      for (let i = startIndex; i < data.length; i++) {
        const row = data[i];
        if (row && row.length > 0) {
          // Get first column value
          const rawPhone = String(row[0]).trim();
          if (rawPhone) {
            const formatted = this.formatPhoneNumber(rawPhone);
            if (this.isValidPhoneNumber(formatted)) {
              phoneNumbers.push(formatted);
            } else {
              invalidCount++;
              this.logger.debug(`Invalid phone number skipped: ${rawPhone}`);
            }
          }
        }
      }

      if (phoneNumbers.length === 0) {
        throw new BadRequestException(
          'No valid phone numbers found in file. Ensure phone numbers are in the first column.',
        );
      }

      // Remove duplicates
      const uniquePhones = [...new Set(phoneNumbers)];

      this.logger.log(
        `Parsed ${uniquePhones.length} unique phone numbers from file (${invalidCount} invalid entries skipped)`,
      );

      return {
        phoneNumbers: uniquePhones,
        totalParsed: uniquePhones.length,
        invalidCount,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error parsing phone numbers file: ${error}`);
      throw new BadRequestException(
        'Failed to parse phone numbers file. Ensure the file is a valid CSV or Excel file.',
      );
    }
  }

  private isHeaderRow(row: string[]): boolean {
    if (!row || row.length === 0) return false;

    const firstCell = String(row[0]).toLowerCase().trim();
    const headerKeywords = [
      'phone',
      'nomor',
      'no',
      'number',
      'hp',
      'telepon',
      'handphone',
      'mobile',
      'whatsapp',
      'wa',
    ];

    return headerKeywords.some(
      (keyword) =>
        firstCell.includes(keyword) || isNaN(Number(firstCell.replace(/\D/g, ''))),
    );
  }

  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Convert leading 0 to 62 (Indonesia country code)
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }

    // Add 62 if number doesn't start with country code
    if (!cleaned.startsWith('62') && cleaned.length >= 9 && cleaned.length <= 13) {
      cleaned = '62' + cleaned;
    }

    return cleaned;
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Must be 10-15 digits
    if (phone.length < 10 || phone.length > 15) {
      return false;
    }

    // Must only contain digits
    if (!/^\d+$/.test(phone)) {
      return false;
    }

    return true;
  }

  validateImageFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    if (!this.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid image type. Allowed: ${this.ALLOWED_IMAGE_TYPES.join(', ')}`,
      );
    }

    if (file.size > this.MAX_IMAGE_SIZE) {
      throw new BadRequestException(
        `Image too large. Maximum size: ${this.MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
      );
    }
  }

  validatePhoneFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No phone numbers file provided');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.ALLOWED_PHONE_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file format. Allowed: ${this.ALLOWED_PHONE_EXTENSIONS.join(', ')}`,
      );
    }

    if (file.size > this.MAX_PHONE_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size: ${this.MAX_PHONE_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
  }

  async moveToUserDirectory(
    tempPath: string,
    userId: string,
    subFolder: 'images' | 'temp' = 'images',
  ): Promise<string> {
    const userDir = path.join(this.uploadsDir, subFolder, userId);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const fileName = `${Date.now()}-${path.basename(tempPath)}`;
    const destPath = path.join(userDir, fileName);

    fs.copyFileSync(tempPath, destPath);
    this.cleanupTempFile(tempPath);

    return destPath;
  }

  cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.debug(`Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup temp file ${filePath}: ${error}`);
    }
  }

  cleanupFiles(...filePaths: (string | undefined)[]): void {
    filePaths.forEach((filePath) => {
      if (filePath) {
        this.cleanupTempFile(filePath);
      }
    });
  }

  getAbsolutePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.join(process.cwd(), relativePath);
  }
}
