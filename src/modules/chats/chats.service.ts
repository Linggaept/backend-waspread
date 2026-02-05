import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChatMessage,
  ChatMessageDirection,
  ChatMessageStatus,
} from '../../database/entities/chat-message.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import type { IncomingMessage } from '../whatsapp/adapters/whatsapp-client.interface';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(BlastMessage)
    private readonly blastMessageRepository: Repository<BlastMessage>,
    private readonly whatsAppService: WhatsAppService,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) {}

  async handleMessageUpsert(
    userId: string,
    message: IncomingMessage,
  ): Promise<void> {
    const waMessageId = message.id?.id;
    if (!waMessageId) return;

    const rawPhone = this.normalizePhoneNumber(
      message.from.replace(/@(c\.us|s\.whatsapp\.net)$/, ''),
    );
    if (!rawPhone) return;

    // For outgoing live messages: skip (sendTextMessage already saved)
    if (message.fromMe) {
      const isHistoryMessage =
        message.timestamp > 0 &&
        Date.now() / 1000 - message.timestamp > 60;

      if (!isHistoryMessage) {
        return;
      }
    }

    // Use Baileys phone as-is (canonical WhatsApp JID)
    const phoneNumber = rawPhone;

    // Dedup: skip if already stored
    const existing = await this.chatMessageRepository.findOne({
      where: { whatsappMessageId: waMessageId },
    });
    if (existing) return;

    const direction = message.fromMe
      ? ChatMessageDirection.OUTGOING
      : ChatMessageDirection.INCOMING;

    const hasMedia = message.hasMedia || false;
    let mediaType: string | undefined;
    if (hasMedia) {
      const type = message.type;
      if (type === 'imageMessage') mediaType = 'image';
      else if (type === 'videoMessage') mediaType = 'video';
      else if (type === 'audioMessage') mediaType = 'audio';
      else if (type === 'documentMessage') mediaType = 'document';
      else if (type === 'stickerMessage') mediaType = 'sticker';
    }

    const timestamp = message.timestamp
      ? new Date(message.timestamp * 1000)
      : new Date();

    // Auto-link to blast campaign if this is an outgoing blast message
    let blastId: string | undefined;
    if (direction === ChatMessageDirection.OUTGOING) {
      const blastMsg = await this.blastMessageRepository.findOne({
        where: { whatsappMessageId: waMessageId },
        select: ['blastId'],
      });
      if (blastMsg) {
        blastId = blastMsg.blastId;
      }
    }

    // For incoming messages, check if this phone was a blast recipient
    if (direction === ChatMessageDirection.INCOMING) {
      const latestBlastMsg = await this.blastMessageRepository
        .createQueryBuilder('bm')
        .select('bm.blastId')
        .where('bm.phoneNumber = :phoneNumber', { phoneNumber })
        .innerJoin('bm.blast', 'blast', 'blast.userId = :userId', { userId })
        .orderBy('bm.createdAt', 'DESC')
        .limit(1)
        .getOne();
      if (latestBlastMsg) {
        blastId = latestBlastMsg.blastId;
      }
    }

    const chatMessage = this.chatMessageRepository.create({
      userId,
      phoneNumber,
      direction,
      body: message.body || '',
      hasMedia,
      mediaType,
      whatsappMessageId: waMessageId,
      messageType: message.type || 'unknown',
      status: direction === ChatMessageDirection.OUTGOING
        ? ChatMessageStatus.SENT
        : ChatMessageStatus.RECEIVED,
      timestamp,
      isRead: direction === ChatMessageDirection.OUTGOING,
      blastId,
    });

    try {
      const saved = await this.chatMessageRepository.save(chatMessage) as ChatMessage;

      // Emit WebSocket event for incoming messages
      if (direction === ChatMessageDirection.INCOMING) {
        this.logger.log(
          `[REALTIME] Incoming message from ${saved.phoneNumber}: "${saved.body?.substring(0, 80) || '[no text]'}" → emitting chat:message to user:${userId}`,
        );

        this.whatsAppGateway.server
          .to(`user:${userId}`)
          .emit('chat:message', {
            id: saved.id,
            phoneNumber: saved.phoneNumber,
            direction: saved.direction,
            body: saved.body,
            hasMedia: saved.hasMedia,
            mediaType: saved.mediaType,
            timestamp: saved.timestamp,
          });
      }
    } catch (error: any) {
      // Unique constraint violation = duplicate, ignore
      if (error?.code === '23505') return;
      this.logger.error(`Failed to store chat message: ${error}`);
    }
  }

  async getConversations(
    userId: string,
    query: { page?: number; limit?: number; search?: string },
  ) {
    const { page = 1, limit = 20, search } = query;

    // Subquery to get latest message per phone number
    const subQuery = this.chatMessageRepository
      .createQueryBuilder('sub')
      .select('sub.phoneNumber', 'phoneNumber')
      .addSelect('MAX(sub.timestamp)', 'maxTimestamp')
      .where('sub.userId = :userId', { userId })
      .groupBy('sub.phoneNumber');

    // Main query with latest message details
    let qb = this.chatMessageRepository
      .createQueryBuilder('msg')
      .innerJoin(
        `(${subQuery.getQuery()})`,
        'latest',
        'msg.phoneNumber = latest."phoneNumber" AND msg.timestamp = latest."maxTimestamp"',
      )
      .setParameters(subQuery.getParameters())
      .where('msg.userId = :userId', { userId });

    if (search) {
      qb = qb.andWhere(
        '(msg.phoneNumber ILIKE :search OR msg.body ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const total = await qb.getCount();

    const messages = await qb
      .orderBy('msg.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get unread counts per conversation
    const phoneNumbers = messages.map((m) => m.phoneNumber);
    let unreadCounts: Record<string, number> = {};

    if (phoneNumbers.length > 0) {
      const unreadResults = await this.chatMessageRepository
        .createQueryBuilder('msg')
        .select('msg.phoneNumber', 'phoneNumber')
        .addSelect('COUNT(*)', 'count')
        .where('msg.userId = :userId', { userId })
        .andWhere('msg.phoneNumber IN (:...phoneNumbers)', { phoneNumbers })
        .andWhere('msg.direction = :direction', {
          direction: ChatMessageDirection.INCOMING,
        })
        .andWhere('msg.isRead = false')
        .groupBy('msg.phoneNumber')
        .getRawMany();

      unreadCounts = unreadResults.reduce(
        (acc, row) => {
          acc[row.phoneNumber] = parseInt(row.count, 10);
          return acc;
        },
        {} as Record<string, number>,
      );
    }

    // Get blast campaign labels per conversation
    let blastLabels: Record<string, { blastId: string; blastName: string }> = {};
    if (phoneNumbers.length > 0) {
      const blastResults = await this.chatMessageRepository
        .createQueryBuilder('msg')
        .select('msg.phoneNumber', 'phoneNumber')
        .addSelect('blast.id', 'blastId')
        .addSelect('blast.name', 'blastName')
        .innerJoin('msg.blast', 'blast')
        .where('msg.userId = :userId', { userId })
        .andWhere('msg.phoneNumber IN (:...phoneNumbers)', { phoneNumbers })
        .andWhere('msg.blastId IS NOT NULL')
        .orderBy('msg.timestamp', 'DESC')
        .getRawMany();

      // Keep the most recent blast per phone number
      for (const row of blastResults) {
        if (!blastLabels[row.phoneNumber]) {
          blastLabels[row.phoneNumber] = {
            blastId: row.blastId,
            blastName: row.blastName,
          };
        }
      }
    }

    const data = messages.map((msg) => ({
      phoneNumber: msg.phoneNumber,
      lastMessage: {
        id: msg.id,
        body: msg.body,
        direction: msg.direction,
        hasMedia: msg.hasMedia,
        mediaType: msg.mediaType,
        timestamp: msg.timestamp,
      },
      unreadCount: unreadCounts[msg.phoneNumber] || 0,
      campaign: blastLabels[msg.phoneNumber] || null,
    }));

    return { data, total, page, limit };
  }

  async getChatHistory(
    userId: string,
    phoneNumber: string,
    query: { page?: number; limit?: number },
  ) {
    const { page = 1, limit = 50 } = query;
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const [messages, total] = await this.chatMessageRepository.findAndCount({
      where: { userId, phoneNumber: normalized },
      relations: ['blast'],
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: [
        'id',
        'direction',
        'body',
        'hasMedia',
        'mediaType',
        'mediaUrl',
        'mimetype',
        'fileName',
        'messageType',
        'status',
        'timestamp',
        'isRead',
        'blastId',
      ],
    });

    const data = messages.reverse().map((msg) => ({
      id: msg.id,
      direction: msg.direction,
      body: msg.body,
      hasMedia: msg.hasMedia,
      mediaType: msg.mediaType,
      mediaUrl: msg.mediaUrl,
      mimetype: msg.mimetype,
      fileName: msg.fileName,
      messageType: msg.messageType,
      status: msg.status,
      timestamp: msg.timestamp,
      isRead: msg.isRead,
      blastId: msg.blastId || null,
      blastName: msg.blast?.name || null,
    }));

    return { data, total, page, limit };
  }

  async markConversationAsRead(
    userId: string,
    phoneNumber: string,
  ): Promise<{ updated: number }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const result = await this.chatMessageRepository.update(
      {
        userId,
        phoneNumber: normalized,
        direction: ChatMessageDirection.INCOMING,
        isRead: false,
      },
      { isRead: true },
    );

    return { updated: result.affected || 0 };
  }

  async sendTextMessage(
    userId: string,
    phoneNumber: string,
    message: string,
  ): Promise<ChatMessage> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Send via WhatsApp
    const result = await this.whatsAppService.sendMessage(
      userId,
      normalized,
      message,
    );

    // Store the outgoing message with normalized phone
    const chatMessage = this.chatMessageRepository.create({
      userId,
      phoneNumber: normalized,
      direction: ChatMessageDirection.OUTGOING,
      body: message,
      hasMedia: false,
      whatsappMessageId: result.messageId || undefined,
      messageType: 'conversation',
      status: result.success
        ? ChatMessageStatus.SENT
        : ChatMessageStatus.FAILED,
      timestamp: new Date(),
      isRead: true,
    });

    const saved = await this.chatMessageRepository.save(chatMessage) as ChatMessage;

    // Emit confirmation via WebSocket
    this.whatsAppGateway.server.to(`user:${userId}`).emit('chat:message-sent', {
      id: saved.id,
      phoneNumber: saved.phoneNumber,
      body: saved.body,
      timestamp: saved.timestamp,
    });

    return saved;
  }

  async sendMediaMessage(
    userId: string,
    phoneNumber: string,
    message: string,
    mediaPath: string,
    mediaType?: string,
  ): Promise<ChatMessage> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Send via WhatsApp
    const result = await this.whatsAppService.sendMessageWithMedia(
      userId,
      normalized,
      message || '',
      mediaPath,
      mediaType,
    );

    // Store the outgoing message with normalized phone
    const chatMessage = this.chatMessageRepository.create({
      userId,
      phoneNumber: normalized,
      direction: ChatMessageDirection.OUTGOING,
      body: message || '',
      hasMedia: true,
      mediaType: mediaType || undefined,
      mediaUrl: mediaPath,
      whatsappMessageId: result.messageId || undefined,
      messageType: mediaType ? `${mediaType}Message` : 'documentMessage',
      status: result.success
        ? ChatMessageStatus.SENT
        : ChatMessageStatus.FAILED,
      timestamp: new Date(),
      isRead: true,
    });

    const saved = await this.chatMessageRepository.save(chatMessage) as ChatMessage;

    // Emit confirmation via WebSocket
    this.whatsAppGateway.server.to(`user:${userId}`).emit('chat:message-sent', {
      id: saved.id,
      phoneNumber: saved.phoneNumber,
      body: saved.body,
      timestamp: saved.timestamp,
    });

    return saved;
  }

  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const count = await this.chatMessageRepository.count({
      where: {
        userId,
        direction: ChatMessageDirection.INCOMING,
        isRead: false,
      },
    });

    return { unreadCount: count };
  }

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    // Strip trailing '0' for Indonesian numbers longer than 13 digits
    // Baileys JID sometimes appends extra '0' (e.g. 62821336953800 → 6282133695380)
    if (cleaned.startsWith('62') && cleaned.length > 13 && cleaned.endsWith('0')) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }
}
