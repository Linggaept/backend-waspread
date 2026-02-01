import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { WhatsAppSession, SessionStatus } from '../../database/entities/whatsapp-session.entity';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';

interface ClientInstance {
  client: Client;
  userId: string;
  isReady: boolean;
}

@Injectable()
export class WhatsAppService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private clients: Map<string, ClientInstance> = new Map();

  constructor(
    @InjectRepository(WhatsAppSession)
    private readonly sessionRepository: Repository<WhatsAppSession>,
    private readonly whatsappGateway: WhatsAppGateway,
  ) {}

  async onModuleDestroy() {
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

  async initializeSession(userId: string, retryCount = 0): Promise<{ status: string; qrCode?: string }> {
    // Check if client already exists
    if (this.clients.has(userId)) {
      const instance = this.clients.get(userId)!;
      if (instance.isReady) {
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
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      },
    });

    const instance: ClientInstance = {
      client,
      userId,
      isReady: false,
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
      await instance.client.sendMessage(chatId, message);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message for user ${userId}`, error);
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

      // Load media from file path
      const media = MessageMedia.fromFilePath(imagePath);

      // Send message with media and caption
      await instance.client.sendMessage(chatId, media, {
        caption: message,
      });

      return true;
    } catch (error) {
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
