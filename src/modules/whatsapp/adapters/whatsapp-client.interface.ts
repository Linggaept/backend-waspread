export interface WhatsAppClientConfig {
  userId: string;
  authPath: string;
  onQr: (qr: string) => void;
  onPairingCode?: (code: string) => void;
  onReady: (info: SessionInfo) => void;
  onDisconnected: (reason: string) => void;
  onAuthFailure: (error: string) => void;
  onMessage: (message: IncomingMessage) => void;
  onMessageUpsert?: (message: IncomingMessage) => void | Promise<void>;
}

export interface SessionInfo {
  phoneNumber: string;
  pushName: string;
}

export interface IncomingMessage {
  id: { id: string }; // WhatsApp message ID
  from: string;
  fromMe: boolean;
  body: string;
  hasMedia: boolean;
  type: string;
  timestamp: number;
  downloadMedia?: () => Promise<MediaData | null>;
}

export interface MediaData {
  mimetype: string;
  data: string; // base64
  filename?: string;
}

export interface SendMessageOptions {
  caption?: string;
  sendMediaAsDocument?: boolean;
}

export interface SentMessageResult {
  messageId: string;
}

export interface ContactInfo {
  phoneNumber: string;
  name: string | null;
  pushname: string | null;
  isMyContact: boolean;
  isWAContact: boolean;
}

export interface IWhatsAppClientAdapter {
  initialize(config: WhatsAppClientConfig): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;

  isReady(): boolean;
  getInfo(): SessionInfo | null;

  sendMessage(chatId: string, content: string): Promise<SentMessageResult>;
  sendMessageWithMedia(
    chatId: string,
    mediaData: MediaData,
    options?: SendMessageOptions,
  ): Promise<SentMessageResult>;

  isRegisteredUser(chatId: string): Promise<boolean>;
  onWhatsApp(jids: string[]): Promise<Array<{ jid: string; exists: boolean }>>;

  getContacts(): Promise<ContactInfo[]>;
  getContactByPhone(phoneNumber: string): Promise<ContactInfo | null>;

  revokeMessage(chatId: string, messageId: string): Promise<void>;

  requestPairingCode(phoneNumber: string): Promise<string>;
}
