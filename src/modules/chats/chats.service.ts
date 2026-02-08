import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';

// Message retention config from ENV
const MESSAGE_RETENTION_DAYS = parseInt(
  process.env.CHAT_MESSAGE_RETENTION_DAYS || '30',
  10,
);
const MESSAGE_CLEANUP_INTERVAL_HOURS = parseInt(
  process.env.CHAT_CLEANUP_INTERVAL_HOURS || '24',
  10,
);
import {
  ChatMessage,
  ChatMessageDirection,
  ChatMessageStatus,
} from '../../database/entities/chat-message.entity';
import { ChatConversation } from '../../database/entities/chat-conversation.entity';
import { BlastMessage } from '../../database/entities/blast.entity';
import { PinnedConversation } from '../../database/entities/pinned-conversation.entity';
import { Contact } from '../../database/entities/contact.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';
import { UploadsService } from '../uploads/uploads.service';
import type { IncomingMessage } from '../whatsapp/adapters/whatsapp-client.interface';

@Injectable()
export class ChatsService implements OnModuleInit {
  private readonly logger = new Logger(ChatsService.name);
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(BlastMessage)
    private readonly blastMessageRepository: Repository<BlastMessage>,
    @InjectRepository(PinnedConversation)
    private readonly pinnedConversationRepository: Repository<PinnedConversation>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(ChatConversation)
    private readonly chatConversationRepository: Repository<ChatConversation>,
    private readonly whatsAppService: WhatsAppService,
    private readonly whatsAppGateway: WhatsAppGateway,
    private readonly uploadsService: UploadsService,
  ) {}

  onModuleInit() {
    // Start periodic cleanup if retention is enabled
    if (MESSAGE_RETENTION_DAYS > 0) {
      const intervalMs = MESSAGE_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
      this.logger.log(
        `Message retention enabled: ${MESSAGE_RETENTION_DAYS} days, cleanup every ${MESSAGE_CLEANUP_INTERVAL_HOURS} hours`,
      );

      // Run initial cleanup after 1 minute (let app fully start)
      setTimeout(() => this.cleanupOldMessages(), 60_000);

      // Schedule periodic cleanup
      this.cleanupInterval = setInterval(() => {
        this.cleanupOldMessages();
      }, intervalMs);
    } else {
      this.logger.log('Message retention disabled (CHAT_MESSAGE_RETENTION_DAYS=0)');
    }
  }

  /**
   * Get the current WA session's phone number for the user
   */
  private async getSessionPhoneNumber(userId: string): Promise<string | null> {
    const session = await this.whatsAppService.getSessionStatus(userId);
    return session?.phoneNumber || null;
  }

  /**
   * Handle message status updates from WhatsApp (sent, delivered, read)
   */
  async handleMessageStatusUpdate(
    userId: string,
    whatsappMessageId: string,
    phoneNumber: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
  ): Promise<void> {
    // Map status string to enum
    const statusMap: Record<string, ChatMessageStatus> = {
      sent: ChatMessageStatus.SENT,
      delivered: ChatMessageStatus.DELIVERED,
      read: ChatMessageStatus.READ,
      failed: ChatMessageStatus.FAILED,
    };

    const newStatus = statusMap[status];
    if (!newStatus) return;

    // Find and update the message
    const message = await this.chatMessageRepository.findOne({
      where: { whatsappMessageId, userId },
    });

    if (!message) return;

    // Only update if new status is "higher" than current
    const statusOrder = ['pending', 'sent', 'delivered', 'read'];
    const currentIndex = statusOrder.indexOf(message.status);
    const newIndex = statusOrder.indexOf(status);

    if (newIndex <= currentIndex && status !== 'failed') return;

    await this.chatMessageRepository.update(message.id, { status: newStatus });

    this.logger.log(
      `[STATUS] Message ${whatsappMessageId} status updated: ${message.status} → ${status}`,
    );

    // Emit WebSocket event for real-time UI update
    this.whatsAppGateway.server
      .to(`user:${userId}`)
      .emit('chat:message-status', {
        messageId: message.id,
        whatsappMessageId,
        phoneNumber: message.phoneNumber,
        status,
      });
  }

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

    const phoneNumber = rawPhone;

    // Get the session phone number (the WA account that's connected)
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      this.logger.warn(`No session phone number found for user ${userId}, skipping message store`);
      return;
    }

    // Dedup: skip if already stored (handles sendTextMessage + blast duplicates)
    const existing = await this.chatMessageRepository.findOne({
      where: { whatsappMessageId: waMessageId },
    });
    if (existing) return;

    const direction = message.fromMe
      ? ChatMessageDirection.OUTGOING
      : ChatMessageDirection.INCOMING;

    const hasMedia = message.hasMedia || false;
    let mediaType: string | undefined;
    let mediaUrl: string | undefined;
    let mimetype: string | undefined;
    let fileName: string | undefined;

    if (hasMedia) {
      const type = message.type;
      if (type === 'imageMessage') mediaType = 'image';
      else if (type === 'videoMessage') mediaType = 'video';
      else if (type === 'audioMessage') mediaType = 'audio';
      else if (type === 'documentMessage') mediaType = 'document';
      else if (type === 'stickerMessage') mediaType = 'sticker';

      // Download media if available
      if (message.downloadMedia) {
        try {
          this.logger.debug(`Downloading media for message ${waMessageId}...`);
          const media = await message.downloadMedia();
          if (media) {
            // Save to storage
            mediaUrl = await this.uploadsService.saveMediaBuffer(
              Buffer.from(media.data, 'base64'),
              userId,
              media.mimetype,
              media.filename,
            );
            mimetype = media.mimetype;
            fileName = media.filename;
            this.logger.debug(`Media saved to ${mediaUrl}`);
          } else {
            this.logger.warn(`Failed to download media for message ${waMessageId}`);
          }
        } catch (error) {
          this.logger.error(`Error downloading media: ${error}`);
        }
      }
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
      sessionPhoneNumber,
      phoneNumber,
      direction,
      body: message.body || '',
      hasMedia,
      mediaType,
      mediaUrl,
      mimetype,
      fileName,
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

      if (direction === ChatMessageDirection.INCOMING) {
        this.logger.log(
          `[REALTIME] Incoming message from ${saved.phoneNumber}: "${saved.body?.substring(0, 80) || '[no text]'}" → emitting chat:message to user:${userId}`,
        );
      } else {
        this.logger.log(
          `[REALTIME] Outgoing message to ${saved.phoneNumber}: "${saved.body?.substring(0, 80) || '[no text]'}" stored via upsert`,
        );
      }

      // Emit WebSocket event for all messages
      this.whatsAppGateway.server
        .to(`user:${userId}`)
        .emit('chat:message', {
          id: saved.id,
          phoneNumber: saved.phoneNumber,
          direction: saved.direction,
          body: saved.body,
          hasMedia: saved.hasMedia,
          mediaType: saved.mediaType,
          mediaUrl: saved.mediaUrl,
          mimetype: saved.mimetype,
          fileName: saved.fileName,
          timestamp: saved.timestamp,
        });

      // [NEW] Sync materialized conversation view
      if (sessionPhoneNumber) {
        this.syncConversation(userId, sessionPhoneNumber, saved.phoneNumber, {
          id: saved.id,
          body: saved.body,
          type: saved.messageType,
          timestamp: saved.timestamp,
          direction: saved.direction,
          isRead: saved.isRead,
          hasMedia: saved.hasMedia,
          blastId: saved.blastId,
          blastName: saved.blast?.name,
        });
      }

      // Emit unread count update for incoming messages
      if (direction === ChatMessageDirection.INCOMING) {
        const { unreadCount } = await this.getUnreadCount(userId);
        this.whatsAppGateway.server
          .to(`user:${userId}`)
          .emit('chat:unread-update', {
            unreadCount,
            phoneNumber: saved.phoneNumber,
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

    // Get current session phone number
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { data: [], total: 0, page, limit };
    }

    // Get Pinned Conversations
    const pinnedConvos = await this.pinnedConversationRepository.find({
      where: { userId, sessionPhoneNumber },
      select: ['phoneNumber'],
    });
    const pinnedSet = new Set(pinnedConvos.map((p) => p.phoneNumber));
    const pinnedPhones = Array.from(pinnedSet);

    // Build Query on ChatConversation (Materialized View)
    const qb = this.chatConversationRepository.createQueryBuilder('c')
      .where('c.userId = :userId', { userId })
      .andWhere('c.sessionPhoneNumber = :sessionPhoneNumber', { sessionPhoneNumber });

    if (search) {
      qb.andWhere(
        '(c.phoneNumber ILIKE :search OR c.contactName ILIKE :search OR c.pushName ILIKE :search OR c.lastMessageBody ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Sort by Pinned (using PostgreSQL CASE EXPRESSION), then by Timestamp
    if (pinnedPhones.length > 0) {
      // Use CASE WHEN to prioritize pinned conversations
      qb.addSelect(
        `CASE WHEN c.phoneNumber IN (:...pinnedPhones) THEN 2 ELSE 1 END`,
        'priority',
      );
      qb.setParameter('pinnedPhones', pinnedPhones);
      qb.orderBy('priority', 'DESC');
      qb.addOrderBy('c.lastMessageTimestamp', 'DESC');
    } else {
      qb.orderBy('c.lastMessageTimestamp', 'DESC');
    }

    // Pagination
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    // Transform to response format
    const data = conversations.map((conv) => {
      return {
        phoneNumber: conv.phoneNumber,
        pushName: conv.pushName || null,
        contactName: conv.contactName || null,
        isPinned: pinnedSet.has(conv.phoneNumber),
        lastMessage: conv.lastMessageTimestamp ? {
          id: conv.lastMessageId || 'old',
          body: conv.lastMessageBody || '',
          direction: conv.lastMessageDirection || 'incoming',
          hasMedia: conv.hasMedia,
          mediaType: conv.lastMessageType,
          timestamp: conv.lastMessageTimestamp,
        } : null,
        unreadCount: conv.unreadCount,
        campaign: conv.blastId ? { blastId: conv.blastId, blastName: conv.blastName || 'Blast' } : null,
      };
    });

    return { data, total, page, limit };
  }

  async getChatHistory(
    userId: string,
    phoneNumber: string,
    query: { page?: number; limit?: number },
  ) {
    const { page = 1, limit = 50 } = query;
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Get current session phone number to filter chats
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { data: [], total: 0, page, limit, contact: null };
    }

    // Get contact info from database first
    const dbContact = await this.contactRepository.findOne({
      where: { userId, phoneNumber: normalized },
      select: ['name', 'waName'],
    });

    // Get contact info (pushName) from WhatsApp as fallback
    const waContact = await this.whatsAppService.getContactByPhone(userId, normalized);

    // Check if conversation is pinned
    const pinnedConvo = await this.pinnedConversationRepository.findOne({
      where: { userId, sessionPhoneNumber, phoneNumber: normalized },
    });

    const [messages, total] = await this.chatMessageRepository.findAndCount({
      where: { userId, sessionPhoneNumber, phoneNumber: normalized },
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
        'isRetracted',
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
      isRetracted: msg.isRetracted || false,
      blastId: msg.blastId || null,
      blastName: msg.blast?.name || null,
    }));

    // Priority: dbContact.name > dbContact.waName > waContact.pushname > waContact.name
    const displayName =
      dbContact?.name ||
      dbContact?.waName ||
      waContact?.pushname ||
      waContact?.name ||
      null;

    return {
      data,
      total,
      page,
      limit,
      contact: {
        phoneNumber: normalized,
        pushName: displayName,
        contactName: dbContact?.name || null,
        isPinned: !!pinnedConvo,
      },
    };
  }

  async markConversationAsRead(
    userId: string,
    phoneNumber: string,
  ): Promise<{ updated: number }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    
    // Get current session phone number
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      this.logger.warn(`No session phone number found for user ${userId}`);
      return { updated: 0 };
    }

    this.logger.debug(
      `Marking read for ${normalized} (session: ${sessionPhoneNumber})`,
    );

    // [NEW] Robust Read Receipt Logic
    // 1. Get ALL unread messages (to ensure we don't miss any if > 20)
    // 2. Get last 20 messages (to force-sync even if DB thinks they are read)
    try {
      const [unreadMessages, recentMessages] = await Promise.all([
        this.chatMessageRepository.find({
          where: {
            userId,
            sessionPhoneNumber,
            phoneNumber: normalized,
            direction: ChatMessageDirection.INCOMING,
            isRead: false,
          },
          select: ['whatsappMessageId'],
          take: 100, // Safety limit: process max 100 unread
        }),
        this.chatMessageRepository.find({
          where: {
            userId,
            sessionPhoneNumber,
            phoneNumber: normalized,
            direction: ChatMessageDirection.INCOMING,
          },
          order: { timestamp: 'DESC' },
          take: 20,
          select: ['whatsappMessageId'],
        }),
      ]);

      // Merge and deduplicate logic
      const uniqueIds = new Set<string>();
      
      unreadMessages.forEach(m => {
        if (m.whatsappMessageId) uniqueIds.add(m.whatsappMessageId);
      });
      
      recentMessages.forEach(m => {
        if (m.whatsappMessageId) uniqueIds.add(m.whatsappMessageId);
      });

      if (uniqueIds.size > 0) {
        const keys = Array.from(uniqueIds).map((id) => ({
          remoteJid: normalized + '@c.us',
          id,
          fromMe: false,
        }));

        this.logger.debug(
          `Sending read receipt for ${keys.length} messages to WA`,
        );
        await this.whatsAppService.markMessagesAsRead(userId, keys);
      }
    } catch (error) {
      this.logger.error(`Failed to send read receipt: ${error}`);
      // Continue to update DB locally even if WA sync fails
    }

    const result = await this.chatMessageRepository.update(
      {
        userId,
        sessionPhoneNumber,
        phoneNumber: normalized,
        direction: ChatMessageDirection.INCOMING,
        isRead: false,
      },
      { isRead: true },
    );

    const updated = result.affected || 0;

    // [NEW] Update materialized view
    await this.chatConversationRepository.update(
      { userId, sessionPhoneNumber, phoneNumber: normalized },
      { unreadCount: 0 },
    );

    // Emit WebSocket events if any messages were marked as read
    if (updated > 0) {
      // Emit conversation read event
      this.whatsAppGateway.server
        .to(`user:${userId}`)
        .emit('chat:conversation-read', {
          phoneNumber: normalized,
          updatedCount: updated,
        });

      // Emit updated unread count
      const { unreadCount } = await this.getUnreadCount(userId);
      this.whatsAppGateway.server
        .to(`user:${userId}`)
        .emit('chat:unread-update', {
          unreadCount,
          phoneNumber: normalized,
        });
    }

    return { updated };
  }

  async sendTextMessage(
    userId: string,
    phoneNumber: string,
    message: string,
  ): Promise<ChatMessage> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Get current session phone number
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);

    // Send via WhatsApp
    const result = await this.whatsAppService.sendMessage(
      userId,
      normalized,
      message,
    );

    // Store the outgoing message with normalized phone
    const chatMessage = this.chatMessageRepository.create({
      userId,
      sessionPhoneNumber: sessionPhoneNumber || undefined,
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

    // Get current session phone number
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);

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
      sessionPhoneNumber: sessionPhoneNumber || undefined,
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
    // Get current session phone number
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { unreadCount: 0 };
    }

    // Optimization: Use ChatConversation unreadCount sum
    // This is instant compared to counting ChatMessage rows
    const result = await this.chatConversationRepository
      .createQueryBuilder('c')
      .select('SUM(c.unreadCount)', 'sum')
      .where('c.userId = :userId', { userId })
      .andWhere('c.sessionPhoneNumber = :sessionPhoneNumber', { sessionPhoneNumber })
      .getRawOne();

    const count = result?.sum ? parseInt(result.sum, 10) : 0;

    return { unreadCount: count };
  }

  /**
   * Delete entire conversation (all messages with a phone number)
   */
  async deleteConversation(
    userId: string,
    phoneNumber: string,
  ): Promise<{ deleted: number }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { deleted: 0 };
    }

    const result = await this.chatMessageRepository.delete({
      userId,
      sessionPhoneNumber,
      phoneNumber: normalized,
    });

    // Also remove from pinned if exists
    await this.pinnedConversationRepository.delete({
      userId,
      sessionPhoneNumber,
      phoneNumber: normalized,
    });

    // Emit conversation deleted event
    this.whatsAppGateway.server
      .to(`user:${userId}`)
      .emit('chat:conversation-deleted', {
        phoneNumber: normalized,
      });

    return { deleted: result.affected || 0 };
  }

  /**
   * Delete a single message (local only)
   */
  async deleteMessage(
    userId: string,
    messageId: string,
  ): Promise<{ deleted: boolean }> {
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { deleted: false };
    }

    const message = await this.chatMessageRepository.findOne({
      where: { id: messageId, userId, sessionPhoneNumber },
    });

    if (!message) {
      return { deleted: false };
    }

    await this.chatMessageRepository.delete({ id: messageId });

    // Emit message deleted event
    this.whatsAppGateway.server
      .to(`user:${userId}`)
      .emit('chat:message-deleted', {
        messageId,
        phoneNumber: message.phoneNumber,
      });

    return { deleted: true };
  }

  /**
   * Retract/revoke a message (delete for everyone on WhatsApp)
   */
  async retractMessage(
    userId: string,
    messageId: string,
  ): Promise<{ retracted: boolean }> {
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { retracted: false };
    }

    const message = await this.chatMessageRepository.findOne({
      where: { id: messageId, userId, sessionPhoneNumber },
    });

    if (!message) {
      return { retracted: false };
    }

    // Can only retract outgoing messages with whatsappMessageId
    if (
      message.direction !== ChatMessageDirection.OUTGOING ||
      !message.whatsappMessageId
    ) {
      return { retracted: false };
    }

    try {
      await this.whatsAppService.revokeMessage(
        userId,
        message.phoneNumber,
        message.whatsappMessageId,
      );

      // Mark message as retracted (keep original body for reference)
      await this.chatMessageRepository.update(messageId, {
        isRetracted: true,
      });

      // Emit message retracted event
      this.whatsAppGateway.server
        .to(`user:${userId}`)
        .emit('chat:message-retracted', {
          messageId,
          phoneNumber: message.phoneNumber,
          isRetracted: true,
        });

      return { retracted: true };
    } catch (error) {
      this.logger.error(`Failed to retract message ${messageId}: ${error}`);
      return { retracted: false };
    }
  }

  /**
   * Pin a conversation
   */
  async pinConversation(
    userId: string,
    phoneNumber: string,
  ): Promise<{ pinned: boolean }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { pinned: false };
    }

    // Check if already pinned
    const existing = await this.pinnedConversationRepository.findOne({
      where: { userId, sessionPhoneNumber, phoneNumber: normalized },
    });

    if (existing) {
      return { pinned: true }; // Already pinned
    }

    const pinned = this.pinnedConversationRepository.create({
      userId,
      sessionPhoneNumber,
      phoneNumber: normalized,
    });

    await this.pinnedConversationRepository.save(pinned);

    // Emit pin event
    this.whatsAppGateway.server
      .to(`user:${userId}`)
      .emit('chat:conversation-pinned', {
        phoneNumber: normalized,
        isPinned: true,
      });

    return { pinned: true };
  }

  /**
   * Unpin a conversation
   */
  async unpinConversation(
    userId: string,
    phoneNumber: string,
  ): Promise<{ unpinned: boolean }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) {
      return { unpinned: false };
    }

    const result = await this.pinnedConversationRepository.delete({
      userId,
      sessionPhoneNumber,
      phoneNumber: normalized,
    });

    if (result.affected && result.affected > 0) {
      // Emit unpin event
      this.whatsAppGateway.server
        .to(`user:${userId}`)
        .emit('chat:conversation-pinned', {
          phoneNumber: normalized,
          isPinned: false,
        });

      return { unpinned: true };
    }

    return { unpinned: false };
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

  /**
   * Cleanup old chat messages based on retention policy
   * Messages older than MESSAGE_RETENTION_DAYS will be deleted
   */
  async cleanupOldMessages(): Promise<{ deleted: number }> {
    if (MESSAGE_RETENTION_DAYS <= 0) {
      return { deleted: 0 };
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MESSAGE_RETENTION_DAYS);

    this.logger.log(
      `Starting message cleanup: deleting messages older than ${cutoffDate.toISOString()}`,
    );

    try {
      // Delete old messages in batches to avoid locking
      const batchSize = 1000;
      let totalDeleted = 0;

      while (true) {
        // Find IDs to delete in batch
        const messagesToDelete = await this.chatMessageRepository
          .createQueryBuilder('msg')
          .select('msg.id')
          .where('msg.timestamp < :cutoffDate', { cutoffDate })
          .take(batchSize)
          .getMany();

        if (messagesToDelete.length === 0) {
          break; // No more messages to delete
        }

        const ids = messagesToDelete.map((m) => m.id);
        const result = await this.chatMessageRepository.delete(ids);

        const deleted = result.affected || 0;
        totalDeleted += deleted;

        if (messagesToDelete.length < batchSize) {
          break; // Last batch
        }

        // Small delay between batches to reduce DB load
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (totalDeleted > 0) {
        this.logger.log(`Message cleanup completed: ${totalDeleted} messages deleted`);
      }

      return { deleted: totalDeleted };
    } catch (error) {
      this.logger.error(`Message cleanup failed: ${error}`);
      return { deleted: 0 };
    }
  }

  /**
   * Get message retention stats
   */
  async getRetentionStats(): Promise<{
    retentionDays: number;
    totalMessages: number;
    oldestMessage: Date | null;
    messagesOlderThanRetention: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MESSAGE_RETENTION_DAYS);

    const [totalMessages, oldestResult, expiredCount] = await Promise.all([
      this.chatMessageRepository.count(),
      this.chatMessageRepository
        .createQueryBuilder('msg')
        .select('MIN(msg.timestamp)', 'oldest')
        .getRawOne(),
      this.chatMessageRepository.count({
        where: { timestamp: LessThan(cutoffDate) },
      }),
    ]);

    return {
      retentionDays: MESSAGE_RETENTION_DAYS,
      totalMessages,
      oldestMessage: oldestResult?.oldest || null,
      messagesOlderThanRetention: expiredCount,
    };
  }
  /**
   * Rebuild materialized view for a user (Migration)
   */
  async syncAllConversations(userId: string): Promise<void> {
    const sessionPhoneNumber = await this.getSessionPhoneNumber(userId);
    if (!sessionPhoneNumber) return;

    this.logger.log(`Starting conversation sync for user ${userId}...`);

    // Get all unique phone numbers
    const phones = await this.chatMessageRepository
      .createQueryBuilder('msg')
      .select('DISTINCT msg.phoneNumber', 'phoneNumber')
      .where('msg.userId = :userId', { userId })
      .andWhere('msg.sessionPhoneNumber = :sessionPhoneNumber', { sessionPhoneNumber })
      .getRawMany();

    this.logger.log(`Found ${phones.length} conversations to sync.`);

    for (const { phoneNumber } of phones) {
      // Get last message
      const lastMessage = await this.chatMessageRepository.findOne({
        where: { userId, sessionPhoneNumber, phoneNumber },
        order: { timestamp: 'DESC' },
        relations: ['blast'],
      });

      if (lastMessage) {
        await this.syncConversation(userId, sessionPhoneNumber, phoneNumber, {
            id: lastMessage.id,
            body: lastMessage.body,
            type: lastMessage.messageType,
            timestamp: lastMessage.timestamp,
            direction: lastMessage.direction,
            isRead: lastMessage.isRead,
            hasMedia: lastMessage.hasMedia,
            blastId: lastMessage.blastId,
            blastName: lastMessage.blast?.name
        });
      }
    }
    this.logger.log(`Conversation sync completed for user ${userId}.`);
  }

  /**
   * Sync conversation state to materialized view (ChatConversation)
   */
  private async syncConversation(
    userId: string,
    sessionPhoneNumber: string,
    phoneNumber: string,
    lastMessage: {
      id?: string;
      body: string;
      type: string;
      timestamp: Date;
      direction: ChatMessageDirection;
      isRead: boolean;
      hasMedia: boolean;
      blastId?: string;
      blastName?: string;
    },
  ): Promise<void> {
    try {
      let conversation = await this.chatConversationRepository.findOne({
        where: { userId, sessionPhoneNumber, phoneNumber },
      });

      if (!conversation) {
        conversation = this.chatConversationRepository.create({
          userId,
          sessionPhoneNumber,
          phoneNumber,
          unreadCount: 0,
        });
      }

      // Update fields
      conversation.lastMessageId = lastMessage.id;
      conversation.lastMessageBody = lastMessage.body;
      conversation.lastMessageType = lastMessage.type;
      conversation.lastMessageTimestamp = lastMessage.timestamp;
      conversation.lastMessageDirection = lastMessage.direction;
      conversation.hasMedia = lastMessage.hasMedia;

      if (lastMessage.blastId) {
        conversation.blastId = lastMessage.blastId;
        conversation.blastName = lastMessage.blastName;
      }


      // Update unread count efficiently
      const unreadCount = await this.chatMessageRepository.count({
        where: {
          userId,
          sessionPhoneNumber,
          phoneNumber,
          direction: ChatMessageDirection.INCOMING,
          isRead: false,
        },
      });
      conversation.unreadCount = unreadCount;

      // Update contact info if needed
      if (!conversation.contactName) {
        const contact = await this.contactRepository.findOne({
          where: { userId, phoneNumber },
        });
        if (contact) {
          conversation.contactName = contact.name;
          conversation.pushName = contact.waName;
        }
      }

      await this.chatConversationRepository.save(conversation);
    } catch (error) {
      this.logger.error(
        `Failed to sync conversation for ${phoneNumber}: ${error}`,
      );
    }
  }
}
