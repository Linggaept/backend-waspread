import { Logger } from '@nestjs/common';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  getContentType,
  proto,
  jidNormalizedUser,
  isPnUser,
  isLidUser,
  fetchLatestBaileysVersion,
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
  // LID to Phone number mapping (for reply detection)
  private lidToPhone: Map<string, string> = new Map();
  // Pending sends: messageId -> phoneNumber (to capture LID when message is sent)
  private pendingSends: Map<string, string> = new Map();

  async initialize(config: WhatsAppClientConfig): Promise<void> {
    this.config = config;

    // Ensure auth directory exists
    if (!fs.existsSync(config.authPath)) {
      fs.mkdirSync(config.authPath, { recursive: true });
    }

    // Manual Persistent Store: Load contacts
    this.loadContacts();

    // Auto-save contacts periodically
    setInterval(() => {
      this.saveContacts();
    }, 10000);

    const { state, saveCreds } = await useMultiFileAuthState(config.authPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.logger.log(`Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('WaSpread'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
    });

    this.setupEvents(saveCreds);
  }

  async getContacts(): Promise<ContactInfo[]> {
    return Array.from(this.contacts.values());
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
          this.cleanupAuthState();
          config.onAuthFailure('Session logged out');
          config.onDisconnected(reason);
        } else if (
          statusCode === DisconnectReason.restartRequired ||
          statusCode === DisconnectReason.badSession ||
          statusCode === 405
        ) {
          this.logger.warn(`Reconnecting due to: ${reason} (code: ${statusCode})`);
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
          const phoneNumber = this.pendingSends.get(msg.key.id || '');
          if (phoneNumber) {
            this.lidToPhone.set(lidId, phoneNumber);

            this.pendingSends.delete(msg.key.id || '');
          }
        }
        
        if (msg.key.fromMe) continue;


        const incomingMessage = await this.mapToIncomingMessage(msg);
        config.onMessage(incomingMessage);
      }
    });

    // Capture initial history sync (contacts often appear here)
    sock.ev.on('messaging-history.set', (history) => {
       const contacts = history.contacts || [];
       const chats = history.chats || [];

       for (const contact of contacts) {
         this.storeContact(contact);
       }
       // Also extract contacts from chats - some contacts only appear as chat JIDs
       for (const chat of chats) {
         if (chat.id && !this.contacts.has(chat.id)) {
           this.storeContact({ id: chat.id, name: chat.name || null, notify: null });
         }
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

    // Listen for LID mapping updates from WhatsApp (Baileys v7+)
    sock.ev.on('lid-mapping.update', (mapping: { lid: string; pn: string }) => {
      const lidId = mapping.lid.replace('@lid', '');
      const phoneNumber = mapping.pn.replace('@s.whatsapp.net', '');
      this.lidToPhone.set(lidId, phoneNumber);

    });
  }



  private storeContact(contact: any): void {
    if (!contact.id) return;

    // Strict Filter for user contacts
    // 1. Must be a standard user JID (@s.whatsapp.net)
    if (!contact.id.endsWith('@s.whatsapp.net')) return;

    // 2. Extract number
    const phoneNumber = contact.id.split('@')[0];

    // 3. E.164 standard max length is 15 digits. 
    // WhatsApp LIDs or other internal IDs often exceed this or look distinct.
    // We assume valid phone numbers are numeric and <= 15 chars.
    if (!/^\d+$/.test(phoneNumber) || phoneNumber.length > 15) return;

    // 4. Filter out specific official/system accounts if needed (e.g. 0)
    if (phoneNumber === '0') return;

    this.contacts.set(contact.id, {
      phoneNumber,
      name: contact.verifiedName || contact.name || null,
      pushname: contact.notify || null,
      isMyContact: !!contact.name || !!contact.verifiedName,
      isWAContact: true,
    });
  }

  private loadContacts(): void {
    try {
      if(!this.config) return;
      const filePath = path.join(this.config.authPath, 'contacts.json');
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const raw = JSON.parse(data);
        Object.entries(raw).forEach(([key, val]) => {
          // Re-validate loaded contacts to filter out any junk from previous bugs
          if (!key.endsWith('@s.whatsapp.net')) return;
          const phoneNumber = key.split('@')[0];
          if (!/^\d+$/.test(phoneNumber) || phoneNumber.length > 15) return;

          this.contacts.set(key, val as ContactInfo);
        });
        this.logger.log(`Loaded ${this.contacts.size} contacts from file`);
      }
    } catch (e) {
      this.logger.warn(`Failed to load contacts: ${e}`);
    }
  }

  private saveContacts(): void {
    try {
      if(!this.config) return;
      const filePath = path.join(this.config.authPath, 'contacts.json');
      const obj = Object.fromEntries(this.contacts);
      fs.writeFileSync(filePath, JSON.stringify(obj));
    } catch (e) {
      // ignore
    }
  }



  private async mapToIncomingMessage(msg: proto.IWebMessageInfo): Promise<IncomingMessage> {
    const messageContent = msg.message;
    const contentType = messageContent
      ? getContentType(messageContent)
      : undefined;
    let from = msg.key?.remoteJid || '';

    // Resolve LID to phone number if available
    if (from.includes('@lid')) {
      const lidId = from.replace('@lid', '');
      let resolvedPhone = this.lidToPhone.get(lidId);
      
      // Fallback: use signalRepository.lidMapping.getPNForLID if in-memory cache doesn't have it
      if (!resolvedPhone && this.sock) {
        try {
          const signalRepo = (this.sock as any).signalRepository;
          if (signalRepo?.lidMapping?.getPNForLID) {
            const pn = await signalRepo.lidMapping.getPNForLID(from);
            if (pn) {
              const resolved = pn.replace('@s.whatsapp.net', '');
              resolvedPhone = resolved;
              // Cache for future use
              this.lidToPhone.set(lidId, resolved);

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
                // Ensure key is present for downloadMediaMessage
                if (!msg.key) throw new Error('Message key is missing');
                
                const buffer = await downloadMediaMessage(msg as any, 'buffer', {});
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
    this.lidToPhone.clear();
    this.pendingSends.clear();

    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
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

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.sock) {
      this.logger.error('Socket not initialized when trying to send message');
      throw new Error('Socket not initialized');
    }

    const jid = this.formatToBaileys(chatId);
    const phoneNumber = jid.replace('@s.whatsapp.net', '');
    
    this.logger.debug(`Sending message to ${jid} (Phone: ${phoneNumber})`);

    try {
      const result = await this.sock.sendMessage(jid, { text: content });
      this.logger.debug(`Message sent to ${jid}, ID: ${result?.key?.id}`);
      
      // Store pending send to capture LID mapping from messages.upsert event
      if (result?.key?.id) {
        this.pendingSends.set(result.key.id, phoneNumber);
      }
      
      this.storeLidMapping(result, jid);
    } catch (error) {
      this.logger.error(`Error sending message to ${jid}: ${error}`);
      throw error;
    }
  }

  async sendMessageWithMedia(
    chatId: string,
    mediaData: MediaData,
    options?: SendMessageOptions,
  ): Promise<void> {
    if (!this.sock) throw new Error('Socket not initialized');

    const jid = this.formatToBaileys(chatId);
    const phoneNumber = jid.replace('@s.whatsapp.net', '');
    const buffer = Buffer.from(mediaData.data, 'base64');
    const mimetype = mediaData.mimetype;
    const caption = options?.caption || '';
    let result: any;

    this.logger.debug(`Sending media to ${jid} (Type: ${mimetype})`);

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
        // Fallback to document
        result = await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName: mediaData.filename || 'file',
          caption,
        });
      }

      this.logger.debug(`Media sent to ${jid}, ID: ${result?.key?.id}`);

      // Store pending send to capture LID mapping from messages.upsert event
      if (result?.key?.id) {
        this.pendingSends.set(result.key.id, phoneNumber);
      }

      // Store LID to phone mapping if participant LID is present
      this.storeLidMapping(result, jid);
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
      this.logger.debug(`Mapped LID ${lidId} -> ${phoneNumber}`);
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
