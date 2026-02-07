import { Logger } from '@nestjs/common';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  getContentType,
  proto,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  IWhatsAppClientAdapter,
  WhatsAppClientConfig,
  SessionInfo,
  IncomingMessage,
  MediaData,
  SendMessageOptions,
  ContactInfo,
  SentMessageResult,
} from './whatsapp-client.interface';

type BaileysSocket = ReturnType<typeof makeWASocket>;

const PENDING_SEND_TTL_MS = 60_000;
const SAVE_DEBOUNCE_MS = 5_000;
const PENDING_CLEANUP_INTERVAL_MS = 30_000;

// History sync config from ENV
const SYNC_FULL_HISTORY = process.env.WA_SYNC_FULL_HISTORY === 'true';
const SYNC_HISTORY_DAYS = parseInt(process.env.WA_SYNC_HISTORY_DAYS || '7', 10);

export class BaileysAdapter implements IWhatsAppClientAdapter {
  private readonly logger = new Logger(BaileysAdapter.name);
  private sock: BaileysSocket | null = null;
  private sessionInfo: SessionInfo | null = null;
  private ready = false;
  private config: WhatsAppClientConfig | null = null;
  private contacts: Map<string, ContactInfo> = new Map();
  private lidToPhone: Map<string, string> = new Map();
  private pendingSends: Map<
    string,
    { phoneNumber: string; createdAt: number }
  > = new Map();

  // Timers & dirty tracking
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private contactsDirty = false;
  private lidDirty = false;
  private saving = false;

  async initialize(config: WhatsAppClientConfig): Promise<void> {
    this.config = config;

    // Ensure auth directory exists (sync ok here - runs once at init before event loop is hot)
    if (!existsSync(config.authPath)) {
      await fs.mkdir(config.authPath, { recursive: true });
    }

    await this.loadContacts();
    await this.loadLidMappings();

    // Periodic cleanup of stale pendingSends
    this.pendingCleanupInterval = setInterval(() => {
      this.cleanupPendingSends();
    }, PENDING_CLEANUP_INTERVAL_MS);

    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.logger.log(
      `Using WA version: ${version.join('.')}, isLatest: ${isLatest}`,
    );

    // Calculate cutoff date for history sync
    const historyCutoff = new Date();
    historyCutoff.setDate(historyCutoff.getDate() - SYNC_HISTORY_DAYS);
    const historyCutoffTimestamp = Math.floor(historyCutoff.getTime() / 1000);

    this.logger.log(
      `History sync config: fullSync=${SYNC_FULL_HISTORY}, days=${SYNC_HISTORY_DAYS}`,
    );

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('WaSpread'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: SYNC_FULL_HISTORY,
      shouldSyncHistoryMessage: (msg) => {
        // If full sync is enabled, sync all
        if (SYNC_FULL_HISTORY) return true;

        // Otherwise, only sync messages within the configured days
        // msg is WAMessage type with messageTimestamp property
        const msgTimestamp = (msg as any).messageTimestamp;
        if (!msgTimestamp) return true; // Allow if no timestamp

        const timestamp =
          typeof msgTimestamp === 'number'
            ? msgTimestamp
            : typeof msgTimestamp === 'object' && msgTimestamp.low
              ? msgTimestamp.low
              : 0;

        return timestamp >= historyCutoffTimestamp;
      },
    });

    this.setupEvents(saveCreds);
  }

  async getContacts(): Promise<ContactInfo[]> {
    return Array.from(this.contacts.values());
  }

  async getContactByPhone(phoneNumber: string): Promise<ContactInfo | null> {
    // Normalize phone number
    let normalized = phoneNumber.replace(/\D/g, '');
    if (normalized.startsWith('0')) {
      normalized = '62' + normalized.substring(1);
    }

    // Try to find in contacts map
    for (const contact of this.contacts.values()) {
      const contactPhone = contact.phoneNumber.replace(/\D/g, '');
      if (contactPhone === normalized) {
        return contact;
      }
    }

    return null;
  }

  async revokeMessage(chatId: string, messageId: string): Promise<void> {
    if (!this.sock) {
      throw new Error('WhatsApp not connected');
    }

    // Format JID if needed
    let jid = chatId;
    if (!jid.includes('@')) {
      jid = `${chatId}@s.whatsapp.net`;
    }

    await this.sock.sendMessage(jid, {
      delete: {
        remoteJid: jid,
        fromMe: true,
        id: messageId,
      },
    });
  }

  private setupEvents(saveCreds: () => Promise<void>): void {
    if (!this.sock || !this.config) return;

    const sock = this.sock;
    const config = this.config;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        config.onQr(qr);
      }

      if (connection === 'open') {
        this.ready = true;

        const user = sock.user;
        if (user) {
          const phoneNumber = user.id.split(':')[0].split('@')[0];
          this.sessionInfo = {
            phoneNumber,
            pushName: user.name || '',
          };
        }

        config.onReady(this.sessionInfo || { phoneNumber: '', pushName: '' });
      }

      if (connection === 'close') {
        this.ready = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reason = this.getDisconnectReason(statusCode);

        if (statusCode === DisconnectReason.loggedOut) {
          this.cleanupAuthState();
          config.onAuthFailure('Session logged out');
          config.onDisconnected(reason);
        } else if (
          statusCode === DisconnectReason.restartRequired ||
          statusCode === DisconnectReason.badSession ||
          statusCode === 405
        ) {
          this.logger.warn(
            `Reconnecting due to: ${reason} (code: ${statusCode})`,
          );
          setTimeout(() => {
            this.initialize(config).catch((err) => {
              this.logger.error(`Reconnection failed: ${err}`);
              config.onDisconnected(`Reconnection failed: ${err}`);
            });
          }, 2000);
        } else {
          config.onDisconnected(reason);
        }
      }
    });

    sock.ev.on('messages.upsert', async (event) => {
      if (event.type !== 'notify') return;

      for (const msg of event.messages) {
        const remoteJid = msg.key.remoteJid || '';

        // Capture LID mapping from messages we send
        if (msg.key.fromMe && remoteJid.includes('@lid')) {
          const lidId = remoteJid.replace('@lid', '');
          const pending = this.pendingSends.get(msg.key.id || '');
          if (pending) {
            this.lidToPhone.set(lidId, pending.phoneNumber);
            this.lidDirty = true;
            this.pendingSends.delete(msg.key.id || '');
          }
        }

        const mappedMessage = await this.mapToIncomingMessage(msg);

        // Fire onMessageUpsert for ALL messages (including fromMe) for chat storage
        if (config.onMessageUpsert) {
          try {
            await config.onMessageUpsert(mappedMessage);
          } catch (e) {
            this.logger.warn(`onMessageUpsert error: ${e}`);
          }
        }

        // Only fire onMessage for incoming (non-fromMe) messages — backward compatible
        if (!msg.key.fromMe) {
          config.onMessage(mappedMessage);
        }
      }
    });

    // Handle message status updates (sent, delivered, read)
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (!update.key?.id || !update.key?.remoteJid) continue;

        const updateStatus = update.update?.status;
        if (updateStatus === undefined) continue;

        // Map Baileys status codes to our status strings
        // 1 = pending, 2 = sent (server ack), 3 = delivered, 4 = read
        let status: 'sent' | 'delivered' | 'read' | 'failed' | undefined;
        switch (updateStatus) {
          case 2:
            status = 'sent';
            break;
          case 3:
            status = 'delivered';
            break;
          case 4:
            status = 'read';
            break;
          default:
            continue; // Skip other status codes
        }

        if (config.onMessageStatusUpdate) {
          try {
            const phoneNumber = update.key.remoteJid
              .replace(/@s\.whatsapp\.net$/, '')
              .replace(/@c\.us$/, '');

            await config.onMessageStatusUpdate({
              messageId: update.key.id,
              remoteJid: phoneNumber,
              status,
            });
          } catch (e) {
            this.logger.warn(`onMessageStatusUpdate error: ${e}`);
          }
        }
      }
    });

    sock.ev.on('messaging-history.set', (history) => {
      const contacts = history.contacts || [];
      const chats = history.chats || [];
      const messages = history.messages || [];

      for (const contact of contacts) {
        this.storeContact(contact);
      }
      for (const chat of chats) {
        if (chat.id && !this.contacts.has(chat.id)) {
          this.storeContact({
            id: chat.id,
            name: chat.name || null,
            notify: null,
          });
        }
      }

      // Extract history messages and fire onMessageUpsert
      if (config.onMessageUpsert && messages.length > 0) {
        for (const msg of messages) {
          try {
            const mapped = this.mapToIncomingMessageSync(msg);
            if (mapped) {
              config.onMessageUpsert(mapped);
            }
          } catch (e) {
            // Skip individual message errors during history sync
          }
        }
        this.logger.log(
          `History sync: processed ${messages.length} messages for chat storage`,
        );
      }

      // Debounced save after history batch
      this.scheduleSave();
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        this.storeContact(contact);
      }
      this.scheduleSave();
    });

    sock.ev.on('contacts.update', (updates) => {
      for (const update of updates) {
        const existing = this.contacts.get(update.id!);
        if (existing) {
          let changed = false;
          if (update.notify && update.notify !== existing.pushname) {
            existing.pushname = update.notify;
            changed = true;
          }
          if (
            (update as any).verifiedName &&
            (update as any).verifiedName !== existing.name
          ) {
            existing.name = (update as any).verifiedName;
            changed = true;
          }
          if (changed) {
            this.contacts.set(update.id!, existing);
            this.contactsDirty = true;
          }
        } else {
          this.storeContact(update as any);
        }
      }
      if (this.contactsDirty) this.scheduleSave();
    });

    sock.ev.on('lid-mapping.update', (mapping: { lid: string; pn: string }) => {
      const lidId = mapping.lid.replace('@lid', '');
      const phoneNumber = mapping.pn.replace('@s.whatsapp.net', '');
      this.lidToPhone.set(lidId, phoneNumber);
      this.lidDirty = true;
      this.scheduleSave();
    });
  }

  private storeContact(contact: any): void {
    if (!contact.id) return;
    if (!contact.id.endsWith('@s.whatsapp.net')) return;

    const phoneNumber = contact.id.split('@')[0];
    if (!/^\d+$/.test(phoneNumber) || phoneNumber.length > 15) return;
    if (phoneNumber === '0') return;

    this.contacts.set(contact.id, {
      phoneNumber,
      name: contact.verifiedName || contact.name || null,
      pushname: contact.notify || null,
      isMyContact: !!contact.name || !!contact.verifiedName,
      isWAContact: true,
    });
    this.contactsDirty = true;
  }

  // --- Debounced async persistence ---

  private scheduleSave(): void {
    if (this.saveDebounceTimer) return;
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.flushToDisk().catch((e) => {
        this.logger.warn(`Failed to flush data to disk: ${e}`);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  private async flushToDisk(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const promises: Promise<void>[] = [];
      if (this.contactsDirty) {
        this.contactsDirty = false;
        promises.push(this.saveContacts());
      }
      if (this.lidDirty) {
        this.lidDirty = false;
        promises.push(this.saveLidMappings());
      }
      await Promise.all(promises);
    } finally {
      this.saving = false;
    }
  }

  private async loadContacts(): Promise<void> {
    try {
      if (!this.config) return;
      const filePath = path.join(this.config.authPath, 'contacts.json');
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        const raw = JSON.parse(data);
        for (const [key, val] of Object.entries(raw)) {
          if (!key.endsWith('@s.whatsapp.net')) continue;
          const phoneNumber = key.split('@')[0];
          if (!/^\d+$/.test(phoneNumber) || phoneNumber.length > 15) continue;
          this.contacts.set(key, val as ContactInfo);
        }
        this.logger.log(`Loaded ${this.contacts.size} contacts from file`);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    } catch (e) {
      this.logger.warn(`Failed to load contacts: ${e}`);
    }
  }

  private async saveContacts(): Promise<void> {
    try {
      if (!this.config) return;
      const filePath = path.join(this.config.authPath, 'contacts.json');
      const obj = Object.fromEntries(this.contacts);
      await fs.writeFile(filePath, JSON.stringify(obj));
    } catch (e) {
      this.logger.warn(`Failed to save contacts: ${e}`);
    }
  }

  private async loadLidMappings(): Promise<void> {
    try {
      if (!this.config) return;
      const filePath = path.join(this.config.authPath, 'lid-mappings.json');
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        const raw = JSON.parse(data) as Record<string, string>;
        for (const [lid, phone] of Object.entries(raw)) {
          this.lidToPhone.set(lid, phone);
        }
        this.logger.log(
          `Loaded ${this.lidToPhone.size} LID mappings from file`,
        );
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    } catch (e) {
      this.logger.warn(`Failed to load LID mappings: ${e}`);
    }
  }

  private async saveLidMappings(): Promise<void> {
    try {
      if (!this.config) return;
      const filePath = path.join(this.config.authPath, 'lid-mappings.json');
      const obj = Object.fromEntries(this.lidToPhone);
      await fs.writeFile(filePath, JSON.stringify(obj));
    } catch (e) {
      this.logger.warn(`Failed to save LID mappings: ${e}`);
    }
  }

  private cleanupPendingSends(): void {
    const now = Date.now();
    for (const [id, entry] of this.pendingSends) {
      if (now - entry.createdAt > PENDING_SEND_TTL_MS) {
        this.pendingSends.delete(id);
      }
    }
  }

  private async mapToIncomingMessage(
    msg: proto.IWebMessageInfo,
  ): Promise<IncomingMessage> {
    const messageContent = msg.message;
    const contentType = messageContent
      ? getContentType(messageContent)
      : undefined;
    let from = msg.key?.remoteJid || '';

    // Resolve LID to phone number if available
    if (from.includes('@lid')) {
      const lidId = from.replace('@lid', '');
      let resolvedPhone = this.lidToPhone.get(lidId);

      if (!resolvedPhone && this.sock) {
        try {
          const signalRepo = (this.sock as any).signalRepository;
          if (signalRepo?.lidMapping?.getPNForLID) {
            const pn = await signalRepo.lidMapping.getPNForLID(from);
            if (pn) {
              const resolved = pn.replace('@s.whatsapp.net', '');
              resolvedPhone = resolved;
              this.lidToPhone.set(lidId, resolved);
              this.lidDirty = true;
              this.scheduleSave();
            }
          }
        } catch (e) {
          this.logger.warn(`Failed to resolve LID via signalRepository: ${e}`);
        }
      }

      if (resolvedPhone) {
        from = `${resolvedPhone}@s.whatsapp.net`;
      } else {
        this.logger.warn(`Could not resolve LID ${lidId} to phone number`);
      }
    }

    let body = '';
    if (contentType === 'conversation') {
      body = messageContent?.conversation || '';
    } else if (contentType === 'extendedTextMessage') {
      body = messageContent?.extendedTextMessage?.text || '';
    } else if (contentType === 'imageMessage') {
      body = messageContent?.imageMessage?.caption || '';
    } else if (contentType === 'videoMessage') {
      body = messageContent?.videoMessage?.caption || '';
    } else if (contentType === 'documentMessage') {
      body = messageContent?.documentMessage?.caption || '';
    }

    const hasMedia = !!(
      contentType === 'imageMessage' ||
      contentType === 'videoMessage' ||
      contentType === 'audioMessage' ||
      contentType === 'documentMessage' ||
      contentType === 'stickerMessage'
    );

    const sock = this.sock;
    return {
      id: { id: msg.key?.id || '' },
      from: this.formatToWWebJS(from),
      fromMe: msg.key?.fromMe || false,
      body,
      hasMedia,
      type: contentType || 'unknown',
      timestamp:
        typeof msg.messageTimestamp === 'number'
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp || 0),
      downloadMedia:
        hasMedia && sock
          ? async (): Promise<MediaData | null> => {
              try {
                if (!msg.key) throw new Error('Message key is missing');

                const buffer = await downloadMediaMessage(
                  msg as any,
                  'buffer',
                  {},
                );
                if (!buffer) return null;

                let mimetype = 'application/octet-stream';
                if (contentType === 'imageMessage')
                  mimetype =
                    messageContent?.imageMessage?.mimetype || 'image/jpeg';
                else if (contentType === 'videoMessage')
                  mimetype =
                    messageContent?.videoMessage?.mimetype || 'video/mp4';
                else if (contentType === 'audioMessage')
                  mimetype =
                    messageContent?.audioMessage?.mimetype || 'audio/ogg';
                else if (contentType === 'documentMessage')
                  mimetype =
                    messageContent?.documentMessage?.mimetype ||
                    'application/octet-stream';

                return {
                  mimetype,
                  data: buffer.toString('base64'),
                  filename: (messageContent as any)?.[contentType]?.fileName,
                };
              } catch (error) {
                return null;
              }
            }
          : undefined,
    };
  }

  private mapToIncomingMessageSync(
    msg: proto.IWebMessageInfo,
  ): IncomingMessage | null {
    const messageContent = msg.message;
    if (!messageContent) return null;

    const contentType = getContentType(messageContent);
    let from = msg.key?.remoteJid || '';

    // Resolve LID to phone number if available
    if (from.includes('@lid')) {
      const lidId = from.replace('@lid', '');
      const resolvedPhone = this.lidToPhone.get(lidId);
      if (resolvedPhone) {
        from = `${resolvedPhone}@s.whatsapp.net`;
      } else {
        return null; // Can't resolve LID, skip
      }
    }

    let body = '';
    if (contentType === 'conversation') {
      body = messageContent?.conversation || '';
    } else if (contentType === 'extendedTextMessage') {
      body = messageContent?.extendedTextMessage?.text || '';
    } else if (contentType === 'imageMessage') {
      body = messageContent?.imageMessage?.caption || '';
    } else if (contentType === 'videoMessage') {
      body = messageContent?.videoMessage?.caption || '';
    } else if (contentType === 'documentMessage') {
      body = messageContent?.documentMessage?.caption || '';
    }

    const hasMedia = !!(
      contentType === 'imageMessage' ||
      contentType === 'videoMessage' ||
      contentType === 'audioMessage' ||
      contentType === 'documentMessage' ||
      contentType === 'stickerMessage'
    );

    return {
      id: { id: msg.key?.id || '' },
      from: this.formatToWWebJS(from),
      fromMe: msg.key?.fromMe || false,
      body,
      hasMedia,
      type: contentType || 'unknown',
      timestamp:
        typeof msg.messageTimestamp === 'number'
          ? msg.messageTimestamp
          : Number(msg.messageTimestamp || 0),
    };
  }

  async destroy(): Promise<void> {
    this.ready = false;
    this.sessionInfo = null;

    // Clear timers to prevent leaks
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (this.pendingCleanupInterval) {
      clearInterval(this.pendingCleanupInterval);
      this.pendingCleanupInterval = null;
    }

    // Flush pending changes before clearing data
    await this.flushToDisk().catch(() => {});

    this.contacts.clear();
    this.lidToPhone.clear();
    this.pendingSends.clear();

    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.ev.removeAllListeners('messaging-history.set');
      this.sock.ev.removeAllListeners('contacts.upsert');
      this.sock.ev.removeAllListeners('contacts.update');
      this.sock.ev.removeAllListeners('lid-mapping.update');
      this.sock.end(undefined);
      this.sock = null;
    }
  }

  async logout(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
    }
    this.cleanupAuthState();
    await this.destroy();
  }

  isReady(): boolean {
    return this.ready && this.sock !== null;
  }

  getInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  async sendMessage(
    chatId: string,
    content: string,
  ): Promise<SentMessageResult> {
    if (!this.sock) {
      this.logger.error('Socket not initialized when trying to send message');
      throw new Error('Socket not initialized');
    }

    const jid = this.formatToBaileys(chatId);
    const phoneNumber = jid.replace('@s.whatsapp.net', '');

    try {
      const result = await this.sock.sendMessage(jid, { text: content });

      if (result?.key?.id) {
        this.pendingSends.set(result.key.id, {
          phoneNumber,
          createdAt: Date.now(),
        });
      }

      this.storeLidMapping(result, jid);

      return { messageId: result?.key?.id || '' };
    } catch (error) {
      this.logger.error(`Error sending message to ${jid}: ${error}`);
      throw error;
    }
  }

  async sendMessageWithMedia(
    chatId: string,
    mediaData: MediaData,
    options?: SendMessageOptions,
  ): Promise<SentMessageResult> {
    if (!this.sock) throw new Error('Socket not initialized');

    const jid = this.formatToBaileys(chatId);
    const phoneNumber = jid.replace('@s.whatsapp.net', '');
    const buffer = Buffer.from(mediaData.data, 'base64');
    const mimetype = mediaData.mimetype;
    const caption = options?.caption || '';
    let result: any;

    try {
      if (options?.sendMediaAsDocument) {
        result = await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName: mediaData.filename || 'document',
          caption,
        });
      } else if (mimetype.startsWith('image/')) {
        result = await this.sock.sendMessage(jid, {
          image: buffer,
          caption,
        });
      } else if (mimetype.startsWith('video/')) {
        result = await this.sock.sendMessage(jid, {
          video: buffer,
          caption,
        });
      } else if (mimetype.startsWith('audio/')) {
        result = await this.sock.sendMessage(jid, {
          audio: buffer,
          mimetype,
          ptt: false,
        });
      } else {
        result = await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName: mediaData.filename || 'file',
          caption,
        });
      }

      if (result?.key?.id) {
        this.pendingSends.set(result.key.id, {
          phoneNumber,
          createdAt: Date.now(),
        });
      }

      this.storeLidMapping(result, jid);

      return { messageId: result?.key?.id || '' };
    } catch (error) {
      this.logger.error(`Error sending media to ${jid}: ${error}`);
      throw error;
    }
  }

  private storeLidMapping(result: any, jid: string): void {
    if (result?.key?.participant && result.key.participant.includes('@lid')) {
      const phoneNumber = jid.replace('@s.whatsapp.net', '');
      const lidId = result.key.participant.replace('@lid', '');
      this.lidToPhone.set(lidId, phoneNumber);
      this.lidDirty = true;
      this.scheduleSave();
    }
  }

  async isRegisteredUser(chatId: string): Promise<boolean> {
    if (!this.sock) throw new Error('Socket not initialized');

    try {
      const jid = this.formatToBaileys(chatId);
      const number = jid.replace('@s.whatsapp.net', '');
      const results = (await this.sock.onWhatsApp(number)) || [];
      const result = results[0];
      return !!result?.exists;
    } catch {
      return true;
    }
  }

  async onWhatsApp(
    jids: string[],
  ): Promise<Array<{ jid: string; exists: boolean }>> {
    if (!this.sock) throw new Error('Socket not initialized');

    const numbers = jids.map((jid) =>
      jid.replace('@s.whatsapp.net', '').replace('@c.us', ''),
    );

    const results = (await this.sock.onWhatsApp(...numbers)) || [];

    return results.map((r) => ({
      jid: this.formatToWWebJS(r.jid),
      exists: !!r.exists,
    }));
  }

  async markMessagesAsRead(
    keys: { remoteJid: string; id: string; fromMe: boolean }[],
  ): Promise<void> {
    if (!this.sock) {
      this.logger.warn('Cannot mark messages as read: Session not active');
      return;
    }

    try {
      const baileysKeys = keys.map((key) => ({
        remoteJid: this.formatToBaileys(key.remoteJid),
        id: key.id,
        fromMe: key.fromMe,
      }));

      await this.sock.readMessages(baileysKeys);
    } catch (error) {
      this.logger.error(`Failed to mark messages as read: ${error}`);
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) throw new Error('Socket not initialized');

    const cleaned = phoneNumber.replace(/\D/g, '');
    const code = await this.sock.requestPairingCode(cleaned);
    return code;
  }

  private formatToWWebJS(jid: string): string {
    return jid.replace('@s.whatsapp.net', '@c.us');
  }

  private formatToBaileys(chatId: string): string {
    return chatId.replace('@c.us', '@s.whatsapp.net');
  }

  private getDisconnectReason(statusCode: number | undefined): string {
    switch (statusCode) {
      case DisconnectReason.loggedOut:
        return 'Logged out';
      case DisconnectReason.connectionClosed:
        return 'Connection closed';
      case DisconnectReason.connectionReplaced:
        return 'Connection replaced by another session';
      case DisconnectReason.timedOut:
        return 'Connection timed out';
      case DisconnectReason.badSession:
        return 'Bad session';
      case DisconnectReason.restartRequired:
        return 'Restart required';
      case DisconnectReason.multideviceMismatch:
        return 'Multi-device mismatch';
      default:
        return `Disconnected (code: ${statusCode || 'unknown'})`;
    }
  }

  private cleanupAuthState(): void {
    if (!this.config) return;
    try {
      // rmSync is acceptable here - runs only on explicit logout, not in hot path
      if (existsSync(this.config.authPath)) {
        const fsSync = require('fs');
        fsSync.rmSync(this.config.authPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up auth state at ${this.config.authPath}`);
      }
    } catch (e) {
      this.logger.warn(`Failed to cleanup auth state: ${e}`);
    }
  }
}
