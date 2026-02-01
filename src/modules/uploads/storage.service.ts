import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export interface UploadResult {
  url: string;
  key: string;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = this.configService.get<string>('R2_BUCKET_NAME') || 'waspread';
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL') || '';

    this.isEnabled = !!(accountId && accessKeyId && secretAccessKey);

    if (this.isEnabled) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
      this.logger.log('Cloudflare R2 storage initialized');
    } else {
      this.logger.warn('Cloudflare R2 not configured, falling back to local storage');
    }
  }

  isR2Enabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Compress image using Sharp
   */
  async compressImage(
    inputPath: string,
    options?: { quality?: number; maxWidth?: number; maxHeight?: number },
  ): Promise<Buffer> {
    const quality = options?.quality || 80;
    const maxWidth = options?.maxWidth || 1920;
    const maxHeight = options?.maxHeight || 1080;

    const sharpModule = await import('sharp');
    const sharpFn = sharpModule.default || sharpModule;
    const image = sharpFn(inputPath);
    const metadata = await image.metadata();

    // Determine output format based on input
    let pipeline = image.resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    });

    // Convert to JPEG for best compression (or keep WebP if already WebP)
    if (metadata.format === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else if (metadata.format === 'png') {
      // Keep PNG for transparency, but optimize
      pipeline = pipeline.png({ quality, compressionLevel: 9 });
    } else {
      // Default to JPEG
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }

    const buffer = await pipeline.toBuffer();
    
    this.logger.debug(
      `Compressed image: ${metadata.size} bytes → ${buffer.length} bytes (${Math.round((1 - buffer.length / (metadata.size || buffer.length)) * 100)}% reduction)`,
    );

    return buffer;
  }

  /**
   * Upload compressed image to R2
   */
  async uploadToR2(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (!this.isEnabled) {
      throw new Error('R2 storage is not configured');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    const url = this.publicUrl
      ? `${this.publicUrl}/${key}`
      : `https://${this.bucket}.r2.dev/${key}`;

    this.logger.log(`Uploaded to R2: ${key} (${buffer.length} bytes)`);

    return {
      url,
      key,
      size: buffer.length,
    };
  }

  /**
   * Compress and upload image to R2
   */
  async compressAndUpload(
    filePath: string,
    userId: string,
    originalName: string,
  ): Promise<UploadResult> {
    // Compress image
    const compressedBuffer = await this.compressImage(filePath);

    // Generate unique key
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const key = `images/${userId}/${timestamp}-${randomId}${ext}`;

    // Determine content type
    const contentType = this.getContentType(ext);

    // Upload to R2
    return this.uploadToR2(compressedBuffer, key, contentType);
  }

  /**
   * Delete file from R2
   */
  async deleteFromR2(key: string): Promise<void> {
    if (!this.isEnabled) return;

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted from R2: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete from R2: ${key}`, error);
    }
  }

  /**
   * Download file from R2 to buffer (for WhatsApp sending)
   */
  async downloadFromR2(key: string): Promise<Buffer> {
    if (!this.isEnabled) {
      throw new Error('R2 storage is not configured');
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Failed to download file: ${key}`);
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Extract R2 key from URL
   */
  extractKeyFromUrl(url: string): string | null {
    if (!url) return null;

    // Handle public URL format
    if (this.publicUrl && url.startsWith(this.publicUrl)) {
      return url.replace(`${this.publicUrl}/`, '');
    }

    // Handle default R2 URL format
    const r2Match = url.match(/\.r2\.dev\/(.+)$/);
    if (r2Match) {
      return r2Match[1];
    }

    return null;
  }

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return types[ext] || 'application/octet-stream';
  }
}
