import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import {
  Blast,
  BlastMessage,
  MessageStatus,
} from '../../../database/entities/blast.entity';
import { BlastReply } from '../../../database/entities/blast-reply.entity';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';

interface IncomingMessage {
  id: { id: string };
  body: string;
  hasMedia: boolean;
  type: string;
  timestamp: number;
  downloadMedia?: () => Promise<{ mimetype: string; data: string }>;
}

@Injectable()
export class ReplyDetectionService {
  private readonly logger = new Logger(ReplyDetectionService.name);
  private readonly LOOKBACK_HOURS = 72;

  constructor(
    @InjectRepository(BlastReply)
    private readonly replyRepository: Repository<BlastReply>,
    @InjectRepository(BlastMessage)
    private readonly blastMessageRepository: Repository<BlastMessage>,
    @InjectRepository(Blast)
    private readonly blastRepository: Repository<Blast>,
    private readonly whatsappGateway: WhatsAppGateway,
  ) {}

  /**
   * Handle incoming WhatsApp message and check if it's a reply to a blast
   */
  async handleIncomingMessage(
    userId: string,
    phoneNumber: string,
    message: IncomingMessage,
  ): Promise<BlastReply | null> {
    try {
      // Find matching blast message within lookback period
      const matchedMessage = await this.findMatchingBlastMessage(
        userId,
        phoneNumber,
      );

      if (!matchedMessage) {
        this.logger.debug(
          `No matching blast found for message from ${phoneNumber}`,
        );
        return null;
      }

      // Create the reply record
      const reply = await this.createReply(
        matchedMessage,
        message,
        phoneNumber,
      );

      // Send real-time notification
      this.whatsappGateway.sendReplyNotification(userId, {
        id: reply.id,
        blastId: reply.blastId,
        blastMessageId: reply.blastMessageId,
        phoneNumber: reply.phoneNumber,
        messageContent: reply.messageContent,
        mediaUrl: reply.mediaUrl,
        mediaType: reply.mediaType,
        receivedAt: reply.receivedAt,
      });

      this.logger.log(
        `Reply detected from ${phoneNumber} for blast ${matchedMessage.blastId}`,
      );

      return reply;
    } catch (error) {
      this.logger.error(
        `Error handling incoming message from ${phoneNumber}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Find a blast message sent to this phone number within the lookback period
   */
  async findMatchingBlastMessage(
    userId: string,
    phoneNumber: string,
  ): Promise<BlastMessage | null> {
    // Normalize phone number (remove leading 0 or +, keep only digits)
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Calculate lookback date
    const lookbackDate = new Date();
    lookbackDate.setHours(lookbackDate.getHours() - this.LOOKBACK_HOURS);

    // Find the most recent sent message to this phone number
    const blastMessage = await this.blastMessageRepository
      .createQueryBuilder('bm')
      .innerJoin('bm.blast', 'b')
      .where('b.userId = :userId', { userId })
      .andWhere('bm.status = :status', { status: MessageStatus.SENT })
      .andWhere('bm.sentAt > :lookbackDate', { lookbackDate })
      .andWhere(
        '(bm.phoneNumber = :phone1 OR bm.phoneNumber = :phone2 OR bm.phoneNumber = :phone3)',
        {
          phone1: normalizedPhone,
          phone2: phoneNumber,
          phone3: phoneNumber.replace(/^\+/, ''),
        },
      )
      .orderBy('bm.sentAt', 'DESC')
      .getOne();

    return blastMessage || null;
  }

  /**
   * Create a reply record in the database
   */
  private async createReply(
    blastMessage: BlastMessage,
    message: IncomingMessage,
    phoneNumber: string,
  ): Promise<BlastReply> {
    // Handle media if present
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    if (message.hasMedia && message.downloadMedia) {
      try {
        const media = await message.downloadMedia();
        // For now, we store media type but not the actual media
        // In a full implementation, you'd upload the media to storage
        mediaType = this.getMediaType(media.mimetype);
      } catch (error) {
        this.logger.warn(`Failed to download media: ${error}`);
      }
    }

    // Create reply record
    const reply = this.replyRepository.create({
      blastId: blastMessage.blastId,
      blastMessageId: blastMessage.id,
      phoneNumber: this.normalizePhoneNumber(phoneNumber),
      messageContent: message.body || '',
      whatsappMessageId: message.id?.id,
      mediaUrl,
      mediaType,
      receivedAt: new Date(message.timestamp * 1000),
      isRead: false,
    });

    await this.replyRepository.save(reply);

    // Increment reply count on blast
    await this.blastRepository.increment(
      { id: blastMessage.blastId },
      'replyCount',
      1,
    );

    return reply;
  }

  /**
   * Normalize phone number to a consistent format
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove JID suffix (everything after @ or :)
    let cleaned = phone.split('@')[0].split(':')[0];

    // Remove all non-digit characters
    cleaned = cleaned.replace(/\D/g, '');

    // Remove leading 0 and add country code if needed
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }

    return cleaned;
  }

  /**
   * Get media type from MIME type
   */
  private getMediaType(mimetype: string): string {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
  }
}
