import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { StorageService } from './storage.service';

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

  constructor(private readonly storageService: StorageService) {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.uploadsDir, this.tempDir, this.imagesDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async parsePhoneNumbersFile(filePath: string): Promise<ParsedPhoneNumbers> {
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
      const phoneNumbers: string[] = [];
      let invalidCount = 0;
      
      const workbook = new ExcelJS.Workbook();
      if (ext === '.csv') {
        await workbook.csv.readFile(filePath);
      } else {
        await workbook.xlsx.readFile(filePath);
      }
      
      const sheet = workbook.getWorksheet(1);
      if (!sheet) {
         throw new BadRequestException('File is empty or corrupted');
      }

      // Check if first row looks like a header
      const firstRow = sheet.getRow(1);
      
      // Handle sparse array (ExcelJS values are 1-based, index 0 is invalid/undefined)
      // .values return [ <empty>, val1, val2 ]
      // We want to check meaningful values
      let headerValues: string[] = [];
      
      if (Array.isArray(firstRow.values)) {
         headerValues = (firstRow.values as any[]).slice(1).map(v => String(v));
      } else if (typeof firstRow.values === 'object') {
         // Some versions might behave differently or sparse object
         headerValues = Object.values(firstRow.values).map(v => String(v));
      }

      const startIndex = this.isHeaderRow(headerValues) ? 2 : 1;
      
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber < startIndex) return;
        
        // Column 1
        const cellValue = row.getCell(1).value;
        if (cellValue) {
           const rawPhone = String(cellValue).trim();
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
      });

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

    // Check first column value
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
    originalName?: string,
  ): Promise<string> {
    // If R2 is enabled and this is an image, compress and upload to R2
    if (subFolder === 'images' && this.storageService.isR2Enabled()) {
      try {
        const result = await this.storageService.compressAndUpload(
          tempPath,
          userId,
          originalName || path.basename(tempPath),
        );
        this.cleanupTempFile(tempPath);
        return result.url;
      } catch (error) {
        this.logger.error(`Failed to upload to R2, falling back to local: ${error}`);
        // Fall through to local storage
      }
    }

    // Local storage fallback
    const userDir = path.join(this.uploadsDir, subFolder, userId);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const fileName = `${Date.now()}-${path.basename(tempPath)}`;
    const destPath = path.join(userDir, fileName);

    fs.copyFileSync(tempPath, destPath);
    this.cleanupTempFile(tempPath);

    // Return relative path for static serving
    return path.join('/uploads', subFolder, userId, fileName);
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
