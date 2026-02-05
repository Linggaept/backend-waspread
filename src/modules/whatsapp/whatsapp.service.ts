import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as qrcode from 'qrcode';
import axios from 'axios';
import {
  WhatsAppSession,
  SessionStatus,
} from '../../database/entities/whatsapp-session.entity';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import { StorageService } from '../uploads/storage.service';
import { BaileysAdapter } from './adapters/baileys.adapter';
import type {
  IWhatsAppClientAdapter,
  MediaData,
} from './adapters/whatsapp-client.interface';

// Interface for reply detection handler
export interface ReplyHandler {
  handleIncomingMessage(
    userId: string,
    phoneNumber: string,
    message: any,
  ): Promise<any>;
}

interface ClientInstance {
  adapter: IWhatsAppClientAdapter;
  userId: string;
  isReady: boolean;
  lastActivity: number;
  isBlasting: boolean;
}

@Injectable()
export class WhatsAppService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private clients: Map<string, ClientInstance> = new Map();
  private mediaCache = new Map<
    string,
    { media: MediaData; expiresAt: number }
  >();

  private readonly AUTH_DIR = '.baileys_auth';
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour media cache TTL
  private readonly MAX_CONCURRENT_SESSIONS = parseInt(
    process.env.MAX_WA_SESSIONS || '20',
    10,
  );
  private readonly IDLE_TIMEOUT_MS =
    parseInt(process.env.WA_IDLE_TIMEOUT_MINUTES || '15', 10) * 60 * 1000;
  private readonly IDLE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

  private idleCheckTimer: NodeJS.Timeout | null = null;
  private replyHandler: ReplyHandler | null = null;

  constructor(
    @InjectRepository(WhatsAppSession)
    private readonly sessionRepository: Repository<WhatsAppSession>,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly storageService: StorageService,
  ) {
    this.startIdleSessionCleanup();
  }

  async onModuleDestroy() {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }

    for (const [userId, instance] of this.clients) {
      try {
        await instance.adapter.destroy();
        this.logger.log(`Client destroyed for user ${userId}`);
      } catch (error) {
        this.logger.error(`Error destroying client for user ${userId}`, error);
      }
    }
  }

  setReplyHandler(handler: ReplyHandler) {
    this.replyHandler = handler;
    this.logger.log('Reply handler registered');
  }

  private startIdleSessionCleanup() {
    this.idleCheckTimer = setInterval(async () => {
      await this.cleanupIdleSessions();
    }, this.IDLE_CHECK_INTERVAL_MS);

    this.logger.log(
      `Idle session cleanup started (timeout: ${this.IDLE_TIMEOUT_MS / 60000} min, max sessions: ${this.MAX_CONCURRENT_SESSIONS})`,
    );
  }

  private async cleanupIdleSessions() {
    const now = Date.now();
    const idleSessions: string[] = [];

    for (const [userId, instance] of this.clients) {
      if (instance.isBlasting) continue;

      const idleTime = now - instance.lastActivity;
      if (idleTime > this.IDLE_TIMEOUT_MS) {
        idleSessions.push(userId);
      }
    }

    for (const userId of idleSessions) {
      this.logger.log(`Auto-disconnecting idle session for user ${userId}`);
      await this.forceDisconnect(userId);

      this.whatsappGateway.sendStatusUpdate(userId, {
        status: SessionStatus.DISCONNECTED,
        reason:
          'Session disconnected due to inactivity. Please reconnect when needed.',
      });
    }

    if (idleSessions.length > 0) {
      this.logger.log(
        `Cleaned up ${idleSessions.length} idle session(s). Active: ${this.clients.size}`,
      );
    }
  }

  getSessionStats(): { active: number; max: number; available: number } {
    return {
      active: this.clients.size,
      max: this.MAX_CONCURRENT_SESSIONS,
      available: Math.max(0, this.MAX_CONCURRENT_SESSIONS - this.clients.size),
    };
  }

  private updateActivity(userId: string) {
    const instance = this.clients.get(userId);
    if (instance) {
      instance.lastActivity = Date.now();
    }
  }

  setBlastingStatus(userId: string, isBlasting: boolean) {
    const instance = this.clients.get(userId);
    if (instance) {
      instance.isBlasting = isBlasting;
      instance.lastActivity = Date.now();
    }
  }

  async initializeSession(
    userId: string,
  ): Promise<{ status: string; qrCode?: string; message?: string }> {
    // Check if client already exists
    if (this.clients.has(userId)) {
      const instance = this.clients.get(userId)!;
      if (instance.isReady) {
        instance.lastActivity = Date.now();
        return { status: 'connected' };
      }

      // Client exists but not ready - destroy and recreate
      this.logger.warn(
        `Client exists but not ready for user ${userId}, destroying and recreating...`,
      );
      try {
        await instance.adapter.destroy();
      } catch (e) {
        this.logger.warn(`Error destroying stale client: ${e}`);
      }
      this.clients.delete(userId);
    }

    // Check session limit
    if (this.clients.size >= this.MAX_CONCURRENT_SESSIONS) {
      this.logger.warn(
        `Session limit reached (${this.clients.size}/${this.MAX_CONCURRENT_SESSIONS}). User ${userId} cannot connect.`,
      );
      return {
        status: 'limit_reached',
        message: `Server is at capacity (${this.MAX_CONCURRENT_SESSIONS} active sessions). Please try again later.`,
      };
    }

    const session = await this.getOrCreateSession(userId);
    await this.updateSessionStatus(userId, SessionStatus.CONNECTING);

    const adapter = new BaileysAdapter();
    const authPath = path.join(process.cwd(), this.AUTH_DIR, userId);

    const instance: ClientInstance = {
      adapter,
      userId,
      isReady: false,
      lastActivity: Date.now(),
      isBlasting: false,
    };

    this.clients.set(userId, instance);

    try {
      await adapter.initialize({
        userId,
        authPath,
        onQr: async (qr: string) => {
          this.logger.log(`QR Code received for user ${userId}`);

          const qrDataUrl = await qrcode.toDataURL(qr);

          await this.updateSessionStatus(userId, SessionStatus.SCANNING);
          await this.sessionRepository.update(
            { userId },
            { lastQrCode: qrDataUrl },
          );

          this.whatsappGateway.sendQrCode(userId, qrDataUrl);
        },
        onReady: async (info) => {
          this.logger.log(`Client ready for user ${userId}`);

          const inst = this.clients.get(userId);
          if (inst) {
            inst.isReady = true;
          }

          const updateData: Partial<WhatsAppSession> = {
            status: SessionStatus.CONNECTED,
            lastConnectedAt: new Date(),
          };

          if (info.phoneNumber) {
            updateData.phoneNumber = info.phoneNumber;
          }
          if (info.pushName) {
            updateData.pushName = info.pushName;
          }

          await this.sessionRepository.update({ userId }, updateData);

          // Clear QR code and disconnect reason
          await this.sessionRepository
            .createQueryBuilder()
            .update(WhatsAppSession)
            .set({ lastQrCode: () => 'NULL', disconnectReason: () => 'NULL' })
            .where('userId = :userId', { userId })
            .execute();

          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.CONNECTED,
            phoneNumber: info.phoneNumber,
            pushName: info.pushName,
          });
        },
        onDisconnected: async (reason: string) => {
          this.logger.log(`Client disconnected for user ${userId}: ${reason}`);

          const inst = this.clients.get(userId);
          if (inst) {
            inst.isReady = false;
          }

          this.clients.delete(userId);

          await this.sessionRepository.update(
            { userId },
            {
              status: SessionStatus.DISCONNECTED,
              lastDisconnectedAt: new Date(),
              disconnectReason: reason,
            },
          );

          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.DISCONNECTED,
            reason,
          });
        },
        onAuthFailure: async (error: string) => {
          this.logger.error(`Auth failure for user ${userId}: ${error}`);
          await this.updateSessionStatus(userId, SessionStatus.FAILED, error);
          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.FAILED,
            error,
          });
        },
        onMessage: async (message) => {
          try {
            if (message.fromMe) return;

            const phoneNumber = message.from.replace('@c.us', '');
            this.logger.log(`[Reply] Incoming message from ${phoneNumber}: "${message.body?.substring(0, 50) || '[no text]'}"`);

            if (this.replyHandler) {
              this.logger.debug(`[Reply] Passing to replyHandler...`);
              await this.replyHandler.handleIncomingMessage(
                userId,
                phoneNumber,
                message,
              );
            } else {
              this.logger.warn(`[Reply] No replyHandler registered!`);
            }
          } catch (error) {
            this.logger.error(`Error processing incoming message: ${error}`);
          }
        },
      });

      return {
        status: 'connecting',
      };
    } catch (error) {
      this.logger.error(
        `Failed to initialize client for user ${userId}`,
        error,
      );

      try {
        await adapter.destroy();
      } catch (e) {}
      this.clients.delete(userId);

      await this.updateSessionStatus(
        userId,
        SessionStatus.FAILED,
        String(error),
      );
      throw error;
    }
  }

  async initializeSessionWithPairing(
    userId: string,
    phoneNumber: string,
  ): Promise<{ status: string; code?: string; message?: string }> {
    // Check if client already exists and is connected
    if (this.clients.has(userId)) {
      const instance = this.clients.get(userId)!;
      if (instance.isReady) {
        instance.lastActivity = Date.now();
        return { status: 'connected' };
      }

      // Client exists but not ready - destroy and recreate
      try {
        await instance.adapter.destroy();
      } catch (e) {
        this.logger.warn(`Error destroying stale client: ${e}`);
      }
      this.clients.delete(userId);
    }

    // Check session limit
    if (this.clients.size >= this.MAX_CONCURRENT_SESSIONS) {
      return {
        status: 'limit_reached',
        message: `Server is at capacity (${this.MAX_CONCURRENT_SESSIONS} active sessions). Please try again later.`,
      };
    }

    await this.getOrCreateSession(userId);
    await this.updateSessionStatus(userId, SessionStatus.CONNECTING);

    const adapter = new BaileysAdapter();
    const authPath = path.join(process.cwd(), this.AUTH_DIR, userId);

    const instance: ClientInstance = {
      adapter,
      userId,
      isReady: false,
      lastActivity: Date.now(),
      isBlasting: false,
    };

    this.clients.set(userId, instance);

    try {
      await adapter.initialize({
        userId,
        authPath,
        onQr: () => {
          // Ignore QR events for pairing code flow
        },
        onReady: async (info) => {
          this.logger.log(`Client ready for user ${userId} (via pairing code)`);

          const inst = this.clients.get(userId);
          if (inst) {
            inst.isReady = true;
          }

          const updateData: Partial<WhatsAppSession> = {
            status: SessionStatus.CONNECTED,
            lastConnectedAt: new Date(),
          };

          if (info.phoneNumber) {
            updateData.phoneNumber = info.phoneNumber;
          }
          if (info.pushName) {
            updateData.pushName = info.pushName;
          }

          await this.sessionRepository.update({ userId }, updateData);

          await this.sessionRepository
            .createQueryBuilder()
            .update(WhatsAppSession)
            .set({ lastQrCode: () => 'NULL', disconnectReason: () => 'NULL' })
            .where('userId = :userId', { userId })
            .execute();

          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.CONNECTED,
            phoneNumber: info.phoneNumber,
            pushName: info.pushName,
          });
        },
        onDisconnected: async (reason: string) => {
          this.logger.log(`Client disconnected for user ${userId}: ${reason}`);

          const inst = this.clients.get(userId);
          if (inst) {
            inst.isReady = false;
          }

          this.clients.delete(userId);

          await this.sessionRepository.update(
            { userId },
            {
              status: SessionStatus.DISCONNECTED,
              lastDisconnectedAt: new Date(),
              disconnectReason: reason,
            },
          );

          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.DISCONNECTED,
            reason,
          });
        },
        onAuthFailure: async (error: string) => {
          this.logger.error(`Auth failure for user ${userId}: ${error}`);
          await this.updateSessionStatus(userId, SessionStatus.FAILED, error);
          this.whatsappGateway.sendStatusUpdate(userId, {
            status: SessionStatus.FAILED,
            error,
          });
        },
        onMessage: async (message) => {
          try {
            if (message.fromMe) return;

            const phoneNumber = message.from.replace('@c.us', '');

            if (this.replyHandler) {
              await this.replyHandler.handleIncomingMessage(
                userId,
                phoneNumber,
                message,
              );
            }
          } catch (error) {
            this.logger.error(`Error processing incoming message: ${error}`);
          }
        },
      });

      // Request pairing code after socket is initialized
      const code = await adapter.requestPairingCode(phoneNumber);

      return {
        status: 'waiting_code',
        code,
      };
    } catch (error) {
      this.logger.error(
        `Failed to initialize pairing for user ${userId}`,
        error,
      );

      try {
        await adapter.destroy();
      } catch (e) {}
      this.clients.delete(userId);

      await this.updateSessionStatus(
        userId,
        SessionStatus.FAILED,
        String(error),
      );
      throw error;
    }
  }

  async disconnectSession(userId: string): Promise<void> {
    const instance = this.clients.get(userId);
    if (instance) {
      try {
        await instance.adapter.logout();
      } catch (error) {
        this.logger.error(
          `Error disconnecting client for user ${userId}`,
          error,
        );
      }
      this.clients.delete(userId);
    }

    await this.updateSessionStatus(
      userId,
      SessionStatus.DISCONNECTED,
      'Manual disconnect',
    );
  }

  async forceDisconnect(userId: string): Promise<void> {
    this.logger.log(`Force disconnecting session for user ${userId}`);

    const instance = this.clients.get(userId);
    if (instance) {
      try {
        await instance.adapter.destroy();
      } catch (error) {
        this.logger.warn(
          `Error destroying client for user ${userId}: ${error}`,
        );
      }
      this.clients.delete(userId);
    }

    await this.updateSessionStatus(
      userId,
      SessionStatus.DISCONNECTED,
      'Force disconnect',
    );
  }

  async getSessionStatus(userId: string): Promise<WhatsAppSession | null> {
    return this.sessionRepository.findOne({ where: { userId } });
  }

  async isNumberRegistered(
    userId: string,
    phoneNumber: string,
  ): Promise<boolean> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      const chatId = this.formatPhoneNumber(phoneNumber);
      return await instance.adapter.isRegisteredUser(chatId);
    } catch (error) {
      this.logger.warn(
        `Failed to check if number ${phoneNumber} is registered: ${error}`,
      );
      return true;
    }
  }

  async sendMessage(
    userId: string,
    phoneNumber: string,
    message: string,
  ): Promise<boolean> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      const chatId = this.formatPhoneNumber(phoneNumber);
      this.updateActivity(userId);
      await instance.adapter.sendMessage(chatId, message);
      return true;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(
        `sendMessage error for user ${userId}: ${errorMessage}`,
      );
      throw error;
    }
  }

  async sendMessageWithMedia(
    userId: string,
    phoneNumber: string,
    message: string,
    mediaPath: string,
    mediaType?: string,
  ): Promise<boolean> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      const chatId = this.formatPhoneNumber(phoneNumber);
      this.updateActivity(userId);

      // Load media
      let mediaData: MediaData;

      if (mediaPath.startsWith('http://') || mediaPath.startsWith('https://')) {
        this.logger.debug(
          `Sending media from URL: ${mediaPath} (type: ${mediaType})`,
        );
        mediaData = await this.getCachedMediaFromUrl(mediaPath);
      } else {
        let absolutePath = mediaPath;
        if (mediaPath.startsWith('/uploads')) {
          absolutePath = path.join(process.cwd(), mediaPath);
        }
        this.logger.debug(
          `Sending media from local: ${absolutePath} (type: ${mediaType})`,
        );
        mediaData = await this.getCachedMedia(absolutePath);
      }

      await instance.adapter.sendMessageWithMedia(chatId, mediaData, {
        sendMediaAsDocument: mediaType === 'document',
        caption: message,
      });

      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to send message with media for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  async isSessionReady(userId: string): Promise<boolean> {
    const instance = this.clients.get(userId);
    return instance?.isReady || false;
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }

    return cleaned + '@c.us';
  }

  private async getCachedMedia(absolutePath: string): Promise<MediaData> {
    const now = Date.now();
    const cached = this.mediaCache.get(absolutePath);

    if (cached && cached.expiresAt > now) {
      cached.expiresAt = now + this.CACHE_TTL_MS;
      return cached.media;
    }

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const buffer = fs.readFileSync(absolutePath);
    const base64 = buffer.toString('base64');
    const mimetype = this.getMimeTypeFromPath(absolutePath);

    const media: MediaData = {
      mimetype,
      data: base64,
      filename: path.basename(absolutePath),
    };

    this.mediaCache.set(absolutePath, {
      media,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    if (this.mediaCache.size > 100) {
      this.cleanupMediaCache();
    }

    return media;
  }

  private cleanupMediaCache() {
    const now = Date.now();
    for (const [key, value] of this.mediaCache.entries()) {
      if (value.expiresAt < now) {
        this.mediaCache.delete(key);
      }
    }
  }

  private async getCachedMediaFromUrl(url: string): Promise<MediaData> {
    const now = Date.now();
    const cached = this.mediaCache.get(url);

    if (cached && cached.expiresAt > now) {
      cached.expiresAt = now + this.CACHE_TTL_MS;
      return cached.media;
    }

    // Try to download via S3 SDK first (bypasses ISP interception)
    let buffer: Buffer;
    const r2Key = this.storageService.extractKeyFromUrl(url);

    if (r2Key && this.storageService.isR2Enabled()) {
      try {
        this.logger.debug(`Downloading from R2 via S3 SDK: ${r2Key}`);
        buffer = await this.storageService.downloadFromR2(r2Key);
      } catch (error) {
        this.logger.warn(`Failed to download via S3 SDK, falling back to HTTP: ${error}`);
        this.logger.debug(`Downloading via HTTP (Fallback): ${url}`);
        buffer = await this.downloadBuffer(url);
      }
    } else {
      this.logger.debug(`Downloading via HTTP: ${url}`);
      buffer = await this.downloadBuffer(url);
    }

    const mimetype = this.getMimeTypeFromPath(url);
    const base64 = buffer.toString('base64');

    const media: MediaData = {
      mimetype,
      data: base64,
    };

    this.mediaCache.set(url, {
      media,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    if (this.mediaCache.size > 100) {
      this.cleanupMediaCache();
    }

    return media;
  }

  private async downloadBuffer(url: string): Promise<Buffer> {
    try {
      this.logger.debug(`Downloading via Axios: ${url}`);
      const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 30000 // 30s timeout
      });
      this.logger.debug(`Download finished via Axios: ${url} (${response.data.length} bytes)`);
      return Buffer.from(response.data);
    } catch (error: any) {
      this.logger.error(`Axios download failed: ${error.message}`);
      throw error;
    }
  }

  private getMimeTypeFromPath(filePath: string): string {
    const ext =
      filePath.split('.').pop()?.toLowerCase()?.split('?')[0] || 'bin';
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      avi: 'video/x-msvideo',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private async getOrCreateSession(userId: string): Promise<WhatsAppSession> {
    let session = await this.sessionRepository.findOne({ where: { userId } });

    if (!session) {
      session = this.sessionRepository.create({
        userId,
        status: SessionStatus.DISCONNECTED,
      });
      await this.sessionRepository.save(session);
    }

    return session;
  }

  private async updateSessionStatus(
    userId: string,
    status: SessionStatus,
    reason?: string,
  ): Promise<void> {
    await this.getOrCreateSession(userId);

    const updateData: Partial<WhatsAppSession> = { status };
    if (reason) {
      updateData.disconnectReason = reason;
    }

    await this.sessionRepository.update({ userId }, updateData);
  }

  async getAllSessions(query?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: SessionStatus;
    sortBy?: string;
    order?: 'ASC' | 'DESC';
  }): Promise<{ data: WhatsAppSession[]; total: number }> {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      sortBy = 'updatedAt',
      order = 'DESC',
    } = query || {};

    const qb = this.sessionRepository.createQueryBuilder('session');
    qb.leftJoinAndSelect('session.user', 'user');

    if (status) {
      qb.andWhere('session.status = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(user.email ILIKE :search OR session.phoneNumber ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy(`session.${sortBy}`, order);
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  async getWhatsAppContacts(userId: string): Promise<{
    contacts: Array<{
      phoneNumber: string;
      name: string | null;
      pushname: string | null;
      isMyContact: boolean;
      isWAContact: boolean;
    }>;
    total: number;
  }> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      this.updateActivity(userId);

      const contacts = await instance.adapter.getContacts();

      this.logger.debug(`Raw contacts from WA: ${contacts.length}`);

      // Filter out empty phone numbers
      const filtered = contacts.filter((c) => c.phoneNumber);

      this.logger.log(
        `Retrieved ${filtered.length} contacts from WhatsApp for user ${userId}`,
      );

      return {
        contacts: filtered,
        total: filtered.length,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get WhatsApp contacts for user ${userId}: ${error}`,
      );
      throw error;
    }
  }

  async checkNumbersRegistered(
    userId: string,
    phoneNumbers: string[],
  ): Promise<{
    registered: string[];
    notRegistered: string[];
  }> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    const registered: string[] = [];
    const notRegistered: string[] = [];

    this.updateActivity(userId);

    for (const phone of phoneNumbers) {
      try {
        const chatId = this.formatPhoneNumber(phone);
        const isRegistered = await instance.adapter.isRegisteredUser(chatId);

        if (isRegistered) {
          registered.push(phone);
        } else {
          notRegistered.push(phone);
        }
      } catch (error) {
        this.logger.warn(`Failed to check number ${phone}: ${error}`);
        registered.push(phone);
      }
    }

    return { registered, notRegistered };
  }
}
