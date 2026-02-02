import { Injectable, Logger, OnModuleDestroy, Inject, forwardRef, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { WhatsAppSession, SessionStatus } from '../../database/entities/whatsapp-session.entity';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import { StorageService } from '../uploads/storage.service';

// Interface for reply detection handler
export interface ReplyHandler {
  handleIncomingMessage(userId: string, phoneNumber: string, message: any): Promise<any>;
}

interface ClientInstance {
  client: Client;
  userId: string;
  isReady: boolean;
  lastActivity: number; // Timestamp of last activity
  isBlasting: boolean;  // Whether actively sending messages
}

@Injectable()
export class WhatsAppService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private clients: Map<string, ClientInstance> = new Map();
  private mediaCache = new Map<string, { media: MessageMedia; expiresAt: number }>();
  
  // Configuration constants
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour media cache TTL
  private readonly MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_WA_SESSIONS || '20', 10);
  private readonly IDLE_TIMEOUT_MS = parseInt(process.env.WA_IDLE_TIMEOUT_MINUTES || '15', 10) * 60 * 1000;
  private readonly IDLE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

  private idleCheckTimer: NodeJS.Timeout | null = null;
  private replyHandler: ReplyHandler | null = null;

  constructor(
    @InjectRepository(WhatsAppSession)
    private readonly sessionRepository: Repository<WhatsAppSession>,
    private readonly whatsappGateway: WhatsAppGateway,
    private readonly storageService: StorageService,
  ) {
    // Start idle session cleanup timer
    this.startIdleSessionCleanup();
  }

  async onModuleDestroy() {
    // Stop idle check timer
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }
    
    // Cleanup all clients on shutdown
    for (const [userId, instance] of this.clients) {
      try {
        await instance.client.destroy();
        this.cleanupSessionLock(userId);
        this.logger.log(`Client destroyed for user ${userId}`);
      } catch (error) {
        this.logger.error(`Error destroying client for user ${userId}`, error);
        // Still try to cleanup locks even if destroy fails
        this.cleanupSessionLock(userId);
      }
    }
  }

  /**
   * Set the reply handler for processing incoming messages
   */
  setReplyHandler(handler: ReplyHandler) {
    this.replyHandler = handler;
    this.logger.log('Reply handler registered');
  }

  /**
   * Start periodic cleanup of idle sessions
   */
  private startIdleSessionCleanup() {
    this.idleCheckTimer = setInterval(async () => {
      await this.cleanupIdleSessions();
    }, this.IDLE_CHECK_INTERVAL_MS);
    
    this.logger.log(`Idle session cleanup started (timeout: ${this.IDLE_TIMEOUT_MS / 60000} min, max sessions: ${this.MAX_CONCURRENT_SESSIONS})`);
  }

  /**
   * Disconnect sessions that have been idle too long
   */
  private async cleanupIdleSessions() {
    const now = Date.now();
    const idleSessions: string[] = [];

    for (const [userId, instance] of this.clients) {
      // Don't disconnect if actively blasting
      if (instance.isBlasting) continue;
      
      const idleTime = now - instance.lastActivity;
      if (idleTime > this.IDLE_TIMEOUT_MS) {
        idleSessions.push(userId);
      }
    }

    for (const userId of idleSessions) {
      this.logger.log(`Auto-disconnecting idle session for user ${userId}`);
      await this.forceDisconnect(userId);
      
      // Notify user via WebSocket
      this.whatsappGateway.sendStatusUpdate(userId, {
        status: SessionStatus.DISCONNECTED,
        reason: 'Session disconnected due to inactivity. Please reconnect when needed.',
      });
    }

    if (idleSessions.length > 0) {
      this.logger.log(`Cleaned up ${idleSessions.length} idle session(s). Active: ${this.clients.size}`);
    }
  }

  /**
   * Get current session statistics
   */
  getSessionStats(): { active: number; max: number; available: number } {
    return {
      active: this.clients.size,
      max: this.MAX_CONCURRENT_SESSIONS,
      available: Math.max(0, this.MAX_CONCURRENT_SESSIONS - this.clients.size),
    };
  }

  /**
   * Update last activity timestamp for a session
   */
  private updateActivity(userId: string) {
    const instance = this.clients.get(userId);
    if (instance) {
      instance.lastActivity = Date.now();
    }
  }

  /**
   * Mark session as blasting (protected from auto-disconnect)
   */
  setBlastingStatus(userId: string, isBlasting: boolean) {
    const instance = this.clients.get(userId);
    if (instance) {
      instance.isBlasting = isBlasting;
      instance.lastActivity = Date.now();
    }
  }

  /**
   * Check if a client instance is still valid (browser not crashed)
   */
  private isClientValid(instance: ClientInstance): boolean {
    try {
      // If client is marked as not ready, it's not valid for sending
      if (!instance.isReady) {
        return false;
      }

      // Check if the client's underlying browser/page is still accessible
      // Note: These are internal whatsapp-web.js properties
      const pupPage = (instance.client as any).pupPage;
      const pupBrowser = (instance.client as any).pupBrowser;
      
      // Only check if these properties exist - if they don't exist yet, assume valid
      // If browser exists but is disconnected, client is invalid
      if (pupBrowser && typeof pupBrowser.isConnected === 'function' && !pupBrowser.isConnected()) {
        this.logger.debug('Browser is disconnected');
        return false;
      }
      
      // If page exists but is closed, client is invalid
      if (pupPage && typeof pupPage.isClosed === 'function' && pupPage.isClosed()) {
        this.logger.debug('Page is closed');
        return false;
      }
      
      return true;
    } catch (error) {
      // If any check throws, log it but assume valid to avoid false negatives
      this.logger.debug(`isClientValid check error: ${error}`);
      return true;
    }
  }

  async initializeSession(userId: string, retryCount = 0): Promise<{ status: string; qrCode?: string; message?: string }> {
    // Check if client already exists
    if (this.clients.has(userId)) {
      const instance = this.clients.get(userId)!;
      if (instance.isReady) {
        instance.lastActivity = Date.now();
        return { status: 'connected' };
      }

      // Client exists but not ready - destroy it and recreate
      this.logger.warn(`Client exists but not ready for user ${userId}, destroying and recreating...`);
      try {
        await instance.client.destroy();
      } catch (e) {
        this.logger.warn(`Error destroying stale client: ${e}`);
      }
      this.clients.delete(userId);
    }

    // Check session limit
    if (this.clients.size >= this.MAX_CONCURRENT_SESSIONS) {
      this.logger.warn(`Session limit reached (${this.clients.size}/${this.MAX_CONCURRENT_SESSIONS}). User ${userId} cannot connect.`);
      return {
        status: 'limit_reached',
        message: `Server is at capacity (${this.MAX_CONCURRENT_SESSIONS} active sessions). Please try again later.`,
      };
    }

    // Kill any orphan chromium processes for this session
    await this.killOrphanProcesses(userId);

    // Create new client
    const session = await this.getOrCreateSession(userId);
    await this.updateSessionStatus(userId, SessionStatus.CONNECTING);

    // Proactively cleanup any stale lock files before starting
    this.cleanupSessionLock(userId);

    // Wait a bit for processes to fully terminate
    await new Promise(resolve => setTimeout(resolve, 500));

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: '.wwebjs_auth',
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          // Note: Removed --no-zygote and --single-process as they cause frame detachment issues
          '--disable-gpu',
          '--disable-software-rasterizer',
          // Memory optimization flags (safe ones only)
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--mute-audio',
        ],
      },
    });

    const instance: ClientInstance = {
      client,
      userId,
      isReady: false,
      lastActivity: Date.now(),
      isBlasting: false,
    };

    this.clients.set(userId, instance);
    this.setupClientEvents(client, userId);

    try {
      await client.initialize();
      return {
        status: 'connecting',
      };
    } catch (error) {
      this.logger.error(`Failed to initialize client for user ${userId}`, error);
      
      // Try to destroy client to free resources
      try { await client.destroy(); } catch (e) {} 
      this.clients.delete(userId);

      const errorMsg = String(error);
      if (errorMsg.includes('locked the profile') || errorMsg.includes('Code: 21') || errorMsg.includes('SingletonLock')) {
        if (retryCount < 2) {
          this.logger.warn(`Profile locked for user ${userId}, cleaning up and retrying (Attempt ${retryCount + 1}/2)...`);
          this.cleanupSessionLock(userId);
          // Wait before retrying (longer wait on second attempt)
          await new Promise(resolve => setTimeout(resolve, 2000 + retryCount * 1000));
          return this.initializeSession(userId, retryCount + 1);
        }

        await this.updateSessionStatus(userId, SessionStatus.FAILED, 'Session locked. Please try again in a few moments.');
      } else {
        await this.updateSessionStatus(userId, SessionStatus.FAILED, String(error));
      }
      
      throw error;
    }
  }

  private async killOrphanProcesses(userId: string): Promise<void> {
    try {
      const { exec } = require('child_process');
      const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${userId}`);

      // Find and kill chromium processes using this session directory
      const cmd = process.platform === 'darwin' || process.platform === 'linux'
        ? `pkill -f "user-data-dir=${sessionPath}" 2>/dev/null || true`
        : `taskkill /F /FI "COMMANDLINE eq *${sessionPath}*" 2>nul || echo ok`;

      await new Promise<void>((resolve) => {
        exec(cmd, (error: Error | null) => {
          if (error) {
            this.logger.debug(`No orphan processes found or error killing: ${error.message}`);
          }
          resolve();
        });
      });
    } catch (e) {
      this.logger.debug(`Error killing orphan processes: ${e}`);
    }
  }

  private cleanupSessionLock(userId: string) {
    try {
      const basePath = process.cwd();
      const sessionDir = path.join(basePath, '.wwebjs_auth', `session-${userId}`);

      // Lock files can be in multiple locations
      const searchPaths = [
        sessionDir,
        path.join(sessionDir, 'Default'),
        path.join(basePath, '.wwebjs_cache'),
        path.join(basePath, '.wwebjs_cache', 'puppeteer'),
      ];

      // Common lock files in Chromium
      const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];

      searchPaths.forEach(searchPath => {
        if (!fs.existsSync(searchPath)) return;

        // Also search subdirectories recursively for lock files
        this.removeLockFilesRecursive(searchPath, locks);
      });
    } catch (e) {
      this.logger.error(`Failed to cleanup session lock: ${e}`);
    }
  }

  private removeLockFilesRecursive(dir: string, locks: string[]) {
    try {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          this.removeLockFilesRecursive(fullPath, locks);
        } else if (locks.includes(entry.name)) {
          // Remove lock file
          try {
            fs.rmSync(fullPath, { force: true });
            this.logger.log(`Removed lock file: ${fullPath}`);
          } catch (e) {
            this.logger.warn(`Could not remove ${fullPath}: ${e}`);
          }
        }
      }
    } catch (e) {
      this.logger.debug(`Error scanning directory ${dir}: ${e}`);
    }
  }

  private setupClientEvents(client: Client, userId: string) {
    client.on('qr', async (qr: string) => {
      this.logger.log(`QR Code received for user ${userId}`);
      
      // Generate QR code as base64
      const qrDataUrl = await qrcode.toDataURL(qr);
      
      // Update session
      await this.updateSessionStatus(userId, SessionStatus.SCANNING);
      await this.sessionRepository.update(
        { userId },
        { lastQrCode: qrDataUrl },
      );

      // Emit via WebSocket
      this.whatsappGateway.sendQrCode(userId, qrDataUrl);
    });

    client.on('ready', async () => {
      this.logger.log(`Client ready for user ${userId}`);
      
      const instance = this.clients.get(userId);
      if (instance) {
        instance.isReady = true;
      }

      const info = client.info;
      const updateData: Partial<WhatsAppSession> = {
        status: SessionStatus.CONNECTED,
        lastConnectedAt: new Date(),
      };
      
      if (info?.wid?.user) {
        updateData.phoneNumber = info.wid.user;
      }
      if (info?.pushname) {
        updateData.pushName = info.pushname;
      }
      
      await this.sessionRepository.update({ userId }, updateData);
      
      // Clear QR code separately using query builder
      await this.sessionRepository
        .createQueryBuilder()
        .update(WhatsAppSession)
        .set({ lastQrCode: () => 'NULL', disconnectReason: () => 'NULL' })
        .where('userId = :userId', { userId })
        .execute();

      // Emit via WebSocket
      this.whatsappGateway.sendStatusUpdate(userId, {
        status: SessionStatus.CONNECTED,
        phoneNumber: info?.wid?.user,
        pushName: info?.pushname,
      });
    });

    client.on('authenticated', () => {
      this.logger.log(`Client authenticated for user ${userId}`);
    });

    client.on('auth_failure', async (msg: string) => {
      this.logger.error(`Auth failure for user ${userId}: ${msg}`);
      await this.updateSessionStatus(userId, SessionStatus.FAILED, msg);
      this.whatsappGateway.sendStatusUpdate(userId, {
        status: SessionStatus.FAILED,
        error: msg,
      });
    });

    client.on('disconnected', async (reason: string) => {
      this.logger.log(`Client disconnected for user ${userId}: ${reason}`);

      const instance = this.clients.get(userId);
      if (instance) {
        instance.isReady = false;
        // Try to destroy client properly
        try {
          await instance.client.destroy();
        } catch (e) {
          this.logger.debug(`Error destroying client on disconnect: ${e}`);
        }
      }

      // Cleanup client from map
      this.clients.delete(userId);

      // Cleanup lock files to prevent issues on reconnect
      this.cleanupSessionLock(userId);

      await this.sessionRepository.update(
        { userId },
        {
          status: SessionStatus.DISCONNECTED,
          lastDisconnectedAt: new Date(),
          disconnectReason: reason,
        },
      );

      // Emit via WebSocket
      this.whatsappGateway.sendStatusUpdate(userId, {
        status: SessionStatus.DISCONNECTED,
        reason,
      });
    });

    // Listen for incoming messages for reply detection
    client.on('message', async (message: any) => {
      try {
        // Ignore messages sent by the user themselves
        if (message.fromMe) return;

        // Extract phone number from message
        const phoneNumber = message.from.replace('@c.us', '');

        // Process through reply handler if available
        if (this.replyHandler) {
          await this.replyHandler.handleIncomingMessage(userId, phoneNumber, message);
        }
      } catch (error) {
        this.logger.error(`Error processing incoming message: ${error}`);
      }
    });
  }

  async disconnectSession(userId: string): Promise<void> {
    const instance = this.clients.get(userId);
    if (instance) {
      try {
        await instance.client.logout();
        await instance.client.destroy();
      } catch (error) {
        this.logger.error(`Error disconnecting client for user ${userId}`, error);
      }
      this.clients.delete(userId);
    }

    // Cleanup lock files to prevent future issues
    this.cleanupSessionLock(userId);

    await this.updateSessionStatus(userId, SessionStatus.DISCONNECTED, 'Manual disconnect');
  }

  async forceDisconnect(userId: string): Promise<void> {
    this.logger.log(`Force disconnecting session for user ${userId}`);

    const instance = this.clients.get(userId);
    if (instance) {
      try {
        await instance.client.destroy();
      } catch (error) {
        this.logger.warn(`Error destroying client for user ${userId}: ${error}`);
      }
      this.clients.delete(userId);
    }

    // Kill any orphan processes
    await this.killOrphanProcesses(userId);

    // Aggressive cleanup of lock files
    this.cleanupSessionLock(userId);

    await this.updateSessionStatus(userId, SessionStatus.DISCONNECTED, 'Force disconnect');
  }

  async getSessionStatus(userId: string): Promise<WhatsAppSession | null> {
    return this.sessionRepository.findOne({ where: { userId } });
  }

  async sendMessage(userId: string, phoneNumber: string, message: string): Promise<boolean> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      // Format phone number (add @c.us suffix)
      const chatId = this.formatPhoneNumber(phoneNumber);
      
      // Update activity timestamp
      this.updateActivity(userId);
      
      await instance.client.sendMessage(chatId, message);
      return true;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(`sendMessage error for user ${userId}: ${errorMessage}`);
      
      // Handle detached frame error specifically
      if (errorMessage.includes('detached Frame') || errorMessage.includes('Protocol error') || errorMessage.includes('Target closed')) {
        this.logger.warn(`Stale client detected for user ${userId}, forcing disconnect...`);
        await this.forceDisconnect(userId);
        throw new Error('WhatsApp session expired. Please reconnect.');
      }
      throw error;
    }
  }

  async sendMessageWithMedia(
    userId: string,
    phoneNumber: string,
    message: string,
    imagePath: string,
  ): Promise<boolean> {
    const instance = this.clients.get(userId);
    if (!instance || !instance.isReady) {
      throw new Error('WhatsApp session is not connected');
    }

    try {
      // Format phone number (add @c.us suffix)
      const chatId = this.formatPhoneNumber(phoneNumber);

      // Update activity timestamp
      this.updateActivity(userId);

      // Load media based on source type
      let media: MessageMedia;
      
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        // R2 URL - download and cache
        this.logger.debug(`Sending image from URL: ${imagePath}`);
        media = await this.getCachedMediaFromUrl(imagePath);
      } else {
        // Local path
        let absolutePath = imagePath;
        if (imagePath.startsWith('/uploads')) {
          absolutePath = path.join(process.cwd(), imagePath);
        }
        this.logger.debug(`Sending image from local: ${absolutePath}`);
        media = await this.getCachedMedia(absolutePath);
      }

      // Send message with media and caption
      await instance.client.sendMessage(chatId, media, {
        caption: message,
      });

      return true;
    } catch (error: any) {
      // Handle detached frame error specifically
      if (error?.message?.includes('detached Frame') || error?.message?.includes('Protocol error')) {
        this.logger.warn(`Stale client detected for user ${userId}, forcing disconnect...`);
        await this.forceDisconnect(userId);
        throw new Error('WhatsApp session expired. Please reconnect.');
      }
      this.logger.error(`Failed to send message with media for user ${userId}`, error);
      throw error;
    }
  }

  async isSessionReady(userId: string): Promise<boolean> {
    const instance = this.clients.get(userId);
    return instance?.isReady || false;
  }

  private formatPhoneNumber(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Remove leading 0 and add country code if needed
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    
    // Add @c.us suffix
    return cleaned + '@c.us';
  }

  private async getCachedMedia(absolutePath: string): Promise<MessageMedia> {
    const now = Date.now();
    const cached = this.mediaCache.get(absolutePath);

    // Return cached if valid
    if (cached && cached.expiresAt > now) {
      // Extend expiration on use
      cached.expiresAt = now + this.CACHE_TTL_MS;
      return cached.media;
    }

    // Load fresh media
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const media = MessageMedia.fromFilePath(absolutePath);
    
    // Validate media loaded correctly
    if (!media || !media.data) {
       throw new Error(`Failed to load media from ${absolutePath}`);
    }

    this.mediaCache.set(absolutePath, {
      media,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    // Cleanup expired cache entries periodically (lazy cleanup)
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

  private async getCachedMediaFromUrl(url: string): Promise<MessageMedia> {
    const now = Date.now();
    const cached = this.mediaCache.get(url);

    // Return cached if valid
    if (cached && cached.expiresAt > now) {
      cached.expiresAt = now + this.CACHE_TTL_MS;
      return cached.media;
    }

    // Try to download via S3 SDK first (bypasses ISP completely)
    let buffer: Buffer;
    const r2Key = this.storageService.extractKeyFromUrl(url);
    
    if (r2Key && this.storageService.isR2Enabled()) {
      this.logger.debug(`Downloading from R2 via S3 SDK: ${r2Key}`);
      buffer = await this.storageService.downloadFromR2(r2Key);
    } else {
      // Fallback to HTTP download
      this.logger.debug(`Downloading via HTTP: ${url}`);
      buffer = await this.downloadImageBuffer(url);
    }
    
    const mimeType = this.getMimeTypeFromUrl(url);
    const base64 = buffer.toString('base64');
    
    const media = new MessageMedia(mimeType, base64);
    
    if (!media || !media.data) {
      throw new Error(`Failed to load media from URL: ${url}`);
    }

    this.mediaCache.set(url, {
      media,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    if (this.mediaCache.size > 100) {
      this.cleanupMediaCache();
    }

    return media;
  }

  private async downloadImageBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const protocol = isHttps ? require('https') : require('http');
      
      // Options to bypass ISP SSL interception (Telkomsel etc)
      const options = isHttps ? { rejectUnauthorized: false } : {};
      
      const request = protocol.get(url, options, (response: any) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.downloadImageBuffer(response.headers.location).then(resolve).catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
      
      request.on('error', reject);
    });
  }

  private getMimeTypeFromUrl(url: string): string {
    const ext = url.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/jpeg';
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

  async getAllSessions(): Promise<WhatsAppSession[]> {
    return this.sessionRepository.find({
      order: { updatedAt: 'DESC' },
    });
  }
}
