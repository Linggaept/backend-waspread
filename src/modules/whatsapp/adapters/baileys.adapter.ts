import { Logger } from '@nestjs/common';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  getContentType,
  proto,
  jidNormalizedUser,
  isJidUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import type {
  IWhatsAppClientAdapter,
  WhatsAppClientConfig,
  SessionInfo,
  IncomingMessage,
  MediaData,
  SendMessageOptions,
  ContactInfo,
} from './whatsapp-client.interface';

type BaileysSocket = ReturnType<typeof makeWASocket>;

export class BaileysAdapter implements IWhatsAppClientAdapter {
  private readonly logger = new Logger(BaileysAdapter.name);
  private sock: BaileysSocket | null = null;
  private sessionInfo: SessionInfo | null = null;
  private ready = false;
  private config: WhatsAppClientConfig | null = null;
  private contacts: Map<string, ContactInfo> = new Map();

  async initialize(config: WhatsAppClientConfig): Promise<void> {
    this.config = config;

    // Ensure auth directory exists
    if (!fs.existsSync(config.authPath)) {
      fs.mkdirSync(config.authPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('WaSpread'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000,
    });

    this.setupEvents(saveCreds);
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

        // Extract session info from socket user
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
          // Session logged out - clear auth state and notify
          this.cleanupAuthState();
          config.onAuthFailure('Session logged out');
        }

        config.onDisconnected(reason);
      }
    });

    sock.ev.on('messages.upsert', async (event) => {
      if (event.type !== 'notify') return;

      for (const msg of event.messages) {
        if (msg.key.fromMe) continue;

        const incomingMessage = this.mapToIncomingMessage(msg);
        config.onMessage(incomingMessage);
      }
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        this.storeContact(contact);
      }
    });

    sock.ev.on('contacts.update', (updates) => {
      for (const update of updates) {
        const existing = this.contacts.get(update.id!);
        if (existing) {
          if (update.notify) existing.pushname = update.notify;
          if ((update as any).verifiedName)
            existing.name = (update as any).verifiedName;
          this.contacts.set(update.id!, existing);
        } else {
          this.storeContact(update as any);
        }
      }
    });
  }

  private storeContact(contact: any): void {
    if (!contact.id) return;

    // Only store individual contacts, not groups or broadcasts
    if (!isJidUser(contact.id)) return;

    const phoneNumber = contact.id.split('@')[0];
    this.contacts.set(contact.id, {
      phoneNumber,
      name: contact.verifiedName || contact.name || null,
      pushname: contact.notify || null,
      isMyContact: !!contact.name || !!contact.verifiedName,
      isWAContact: true,
    });
  }

  private mapToIncomingMessage(msg: proto.IWebMessageInfo): IncomingMessage {
    const messageContent = msg.message;
    const contentType = messageContent
      ? getContentType(messageContent)
      : undefined;
    const from = msg.key.remoteJid || '';

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
      from: this.formatToWWebJS(from),
      fromMe: msg.key.fromMe || false,
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
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
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

  async destroy(): Promise<void> {
    this.ready = false;
    this.sessionInfo = null;
    this.contacts.clear();

    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.ev.removeAllListeners('contacts.upsert');
      this.sock.ev.removeAllListeners('contacts.update');
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

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.sock) throw new Error('Socket not initialized');

    const jid = this.formatToBaileys(chatId);
    await this.sock.sendMessage(jid, { text: content });
  }

  async sendMessageWithMedia(
    chatId: string,
    mediaData: MediaData,
    options?: SendMessageOptions,
  ): Promise<void> {
    if (!this.sock) throw new Error('Socket not initialized');

    const jid = this.formatToBaileys(chatId);
    const buffer = Buffer.from(mediaData.data, 'base64');
    const mimetype = mediaData.mimetype;
    const caption = options?.caption || '';

    if (options?.sendMediaAsDocument) {
      await this.sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: mediaData.filename || 'document',
        caption,
      });
    } else if (mimetype.startsWith('image/')) {
      await this.sock.sendMessage(jid, {
        image: buffer,
        caption,
      });
    } else if (mimetype.startsWith('video/')) {
      await this.sock.sendMessage(jid, {
        video: buffer,
        caption,
      });
    } else if (mimetype.startsWith('audio/')) {
      await this.sock.sendMessage(jid, {
        audio: buffer,
        mimetype,
        ptt: false,
      });
    } else {
      // Fallback to document
      await this.sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: mediaData.filename || 'file',
        caption,
      });
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
      // If check fails, assume registered to avoid false negatives
      return true;
    }
  }

  async onWhatsApp(
    jids: string[],
  ): Promise<Array<{ jid: string; exists: boolean }>> {
    if (!this.sock) throw new Error('Socket not initialized');

    // Extract phone numbers (remove suffix)
    const numbers = jids.map((jid) =>
      jid.replace('@s.whatsapp.net', '').replace('@c.us', ''),
    );

    const results = (await this.sock.onWhatsApp(...numbers)) || [];

    return results.map((r) => ({
      jid: this.formatToWWebJS(r.jid),
      exists: !!r.exists,
    }));
  }

  async getContacts(): Promise<ContactInfo[]> {
    return Array.from(this.contacts.values());
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) throw new Error('Socket not initialized');

    // Remove any non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    const code = await this.sock.requestPairingCode(cleaned);
    return code;
  }

  // JID format conversion utilities
  // whatsapp-web.js uses @c.us, Baileys uses @s.whatsapp.net
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
      if (fs.existsSync(this.config.authPath)) {
        fs.rmSync(this.config.authPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up auth state at ${this.config.authPath}`);
      }
    } catch (e) {
      this.logger.warn(`Failed to cleanup auth state: ${e}`);
    }
  }
}
