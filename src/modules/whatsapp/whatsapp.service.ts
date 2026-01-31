import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client, LocalAuth } from 'whatsapp-web.js';
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
      // Client exists but not ready, get current status
      const session = await this.getOrCreateSession(userId);
      return {
        status: session.status,
        qrCode: session.lastQrCode || undefined,
      };
    }

    // Create new client
    const session = await this.getOrCreateSession(userId);
    await this.updateSessionStatus(userId, SessionStatus.CONNECTING);

    // Proactively cleanup any stale lock files before starting
    this.cleanupSessionLock(userId);

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

  private cleanupSessionLock(userId: string) {
    try {
      const basePath = process.cwd();
      // Lock files can be in multiple locations
      const searchPaths = [
        path.join(basePath, '.wwebjs_auth', `session-${userId}`),
        path.join(basePath, '.wwebjs_auth', `session-${userId}`, 'Default'),
        path.join(basePath, '.wwebjs_cache'),
        path.join(basePath, '.wwebjs_cache', 'puppeteer'),
      ];

      // Common lock files in Chromium
      const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

      searchPaths.forEach(searchPath => {
        if (!fs.existsSync(searchPath)) return;

        locks.forEach(file => {
          const filePath = path.join(searchPath, file);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              this.logger.log(`Removed stale lock file: ${filePath}`);
            }
          } catch (e) {
            // Try to remove by force (symlink or other)
            try {
              fs.rmSync(filePath, { force: true });
              this.logger.log(`Force removed lock file: ${filePath}`);
            } catch (e2) {
              this.logger.warn(`Could not remove ${filePath}: ${e2}`);
            }
          }
        });
      });
    } catch (e) {
      this.logger.error(`Failed to cleanup session lock: ${e}`);
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
      }

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

      // Cleanup client
      this.clients.delete(userId);
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
