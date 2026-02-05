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
  private readonly ALLOWED_MEDIA_TYPES: Record<string, string[]> = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    video: ['video/mp4', 'video/3gpp', 'video/quicktime', 'video/x-msvideo'],
    audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4'],
    document: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
  };
  private readonly MAX_PHONE_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  private readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  private readonly MAX_MEDIA_SIZE = 20 * 1024 * 1024; // 20MB for all media

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
      const seenPhones = new Set<string>(); // Prevent duplicates
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
      let headerValues: string[] = [];

      if (Array.isArray(firstRow.values)) {
        headerValues = (firstRow.values as any[]).slice(1).map((v) =>
          String(v || '')
            .toLowerCase()
            .trim(),
        );
      } else if (typeof firstRow.values === 'object') {
        headerValues = Object.values(firstRow.values).map((v) =>
          String(v || '')
            .toLowerCase()
            .trim(),
        );
      }

      const hasHeader = this.isHeaderRow(headerValues);

      sheet.eachRow((row, rowNumber) => {
        // Skip header row if detected
        if (rowNumber === 1 && hasHeader) return;

        // Scan ALL cells in this row to find phone numbers
        row.eachCell((cell) => {
          const cellValue = String(cell.value || '').trim();
          if (!cellValue) return;

          // Try to extract phone number from this cell
          const extractedPhone = this.extractPhoneNumber(cellValue);
          if (extractedPhone) {
            // Skip if already seen (duplicate)
            if (!seenPhones.has(extractedPhone)) {
              seenPhones.add(extractedPhone);
              phoneNumbers.push(extractedPhone);
            }
          } else if (this.looksLikePhoneAttempt(cellValue)) {
            // Only count as invalid if it looks like a phone attempt but failed validation
            invalidCount++;
            this.logger.debug(`Invalid phone number skipped: ${cellValue}`);
          }
        });
      });

      if (phoneNumbers.length === 0) {
        throw new BadRequestException('No valid phone numbers found in file.');
      }

      this.logger.log(
        `Parsed ${phoneNumbers.length} unique phone numbers from file (${invalidCount} invalid entries skipped)`,
      );

      return {
        phoneNumbers,
        totalParsed: phoneNumbers.length,
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
   * Check if a value looks like an attempted phone number (has some digits but invalid)
   */
  private looksLikePhoneAttempt(value: string): boolean {
    const digitsOnly = value.replace(/\D/g, '');
    // Has 5-9 digits - looks like a phone attempt but too short
    return digitsOnly.length >= 5 && digitsOnly.length < 10;
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
        firstCell.includes(keyword) ||
        isNaN(Number(firstCell.replace(/\D/g, ''))),
    );
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

  /**
   * Validate media file (image, video, audio, document)
   * Returns the media type category
   */
  validateMediaFile(
    file: Express.Multer.File,
  ): 'image' | 'video' | 'audio' | 'document' {
    if (!file) {
      throw new BadRequestException('No media file provided');
    }

    // Find which category this mimetype belongs to
    let mediaType: 'image' | 'video' | 'audio' | 'document' | null = null;

    for (const [type, mimetypes] of Object.entries(this.ALLOWED_MEDIA_TYPES)) {
      if (mimetypes.includes(file.mimetype)) {
        mediaType = type as 'image' | 'video' | 'audio' | 'document';
        break;
      }
    }

    if (!mediaType) {
      const allTypes = Object.values(this.ALLOWED_MEDIA_TYPES).flat();
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed types: images, videos, audio, documents (PDF, Word, Excel, etc.)`,
      );
    }

    if (file.size > this.MAX_MEDIA_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size: ${this.MAX_MEDIA_SIZE / (1024 * 1024)}MB`,
      );
    }

    return mediaType;
  }

  /**
   * Get media type from mimetype
   */
  getMediaType(
    mimetype: string,
  ): 'image' | 'video' | 'audio' | 'document' | null {
    for (const [type, mimetypes] of Object.entries(this.ALLOWED_MEDIA_TYPES)) {
      if (mimetypes.includes(mimetype)) {
        return type as 'image' | 'video' | 'audio' | 'document';
      }
    }
    return null;
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
    subFolder: 'images' | 'media' | 'temp' = 'images',
    originalName?: string,
  ): Promise<string> {
    // If R2 is enabled and this is an image, compress and upload to R2
    if (
      (subFolder === 'images' || subFolder === 'media') &&
      this.storageService.isR2Enabled()
    ) {
      try {
        const result = await this.storageService.compressAndUpload(
          tempPath,
          userId,
          originalName || path.basename(tempPath),
        );
        this.cleanupTempFile(tempPath);
        return result.url;
      } catch (error) {
        this.logger.error(
          `Failed to upload to R2, falling back to local: ${error}`,
        );
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
