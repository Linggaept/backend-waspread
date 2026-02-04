import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../../database/entities/notification.entity';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:2004', 'https://waspread.vercel.app', 'https://waspread.com', 'https://api.netadev.my.id', 'https://www.netadev.my.id'],
  },
  namespace: '/whatsapp',
})
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WhatsAppGateway.name);

  @WebSocketServer()
  server: Server;

  // Map userId to socket IDs
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Remove from all user mappings
    for (const [userId, sockets] of this.userSockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const { userId } = data;
    this.logger.log(`User ${userId} subscribed via socket ${client.id}`);

    // Add socket to user's room
    client.join(`user:${userId}`);

    // Track socket
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);

    // Send initial notification count
    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    client.emit('notification:count', { unreadCount });

    return { success: true };
  }

  @SubscribeMessage('get-notification-count')
  async handleGetNotificationCount(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const { userId } = data;
    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    
    client.emit('notification:count', { unreadCount });
    return { unreadCount };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const { userId } = data;
    this.logger.log(`User ${userId} unsubscribed from socket ${client.id}`);

    // Remove socket from user's room
    client.leave(`user:${userId}`);

    // Remove from tracking
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    return { success: true };
  }

  // Send QR code to specific user
  sendQrCode(userId: string, qrCode: string) {
    this.server.to(`user:${userId}`).emit('qr', { qrCode });
    this.logger.log(`QR code sent to user ${userId}`);
  }

  // Send status update to specific user
  sendStatusUpdate(userId: string, status: Record<string, unknown>) {
    this.server.to(`user:${userId}`).emit('status', status);
    this.logger.log(`Status update sent to user ${userId}: ${JSON.stringify(status)}`);
  }

  // Send message status update
  sendMessageStatus(userId: string, messageId: string, status: string) {
    this.server.to(`user:${userId}`).emit('message-status', { messageId, status });
  }

  // Send reply notification to user
  sendReplyNotification(userId: string, reply: {
    id: string;
    blastId: string;
    blastMessageId?: string;
    phoneNumber: string;
    messageContent: string;
    mediaUrl?: string;
    mediaType?: string;
    receivedAt: Date;
  }) {
    this.server.to(`user:${userId}`).emit('blast-reply', reply);
    this.logger.log(`Reply notification sent to user ${userId} from ${reply.phoneNumber}`);
  }

  // ==================== Blast Progress Events ====================

  // Send blast started notification
  sendBlastStarted(userId: string, data: {
    blastId: string;
    name: string;
    total: number;
  }) {
    this.server.to(`user:${userId}`).emit('blast-started', data);
    this.logger.log(`Blast started: ${data.name} (${data.total} recipients)`);
  }

  // Send blast progress notification
  sendBlastProgress(userId: string, data: {
    blastId: string;
    sent: number;
    failed: number;
    invalid: number;
    pending: number;
    total: number;
    percentage: number;
  }) {
    this.server.to(`user:${userId}`).emit('blast-progress', data);
  }

  // Send blast completed notification
  sendBlastCompleted(userId: string, data: {
    blastId: string;
    status: string;
    sent: number;
    failed: number;
    invalid: number;
    duration: number; // in seconds
  }) {
    this.server.to(`user:${userId}`).emit('blast-completed', data);
    this.logger.log(`Blast completed: ${data.blastId} - ${data.status} (${data.sent} sent, ${data.failed} failed, ${data.invalid} invalid)`);
  }

  // ==================== Subscription/Quota Events ====================

  // Send quota warning notification
  sendQuotaWarning(userId: string, data: {
    remaining: number;
    limit: number;
    warningType: 'low' | 'critical' | 'depleted';
  }) {
    this.server.to(`user:${userId}`).emit('quota-warning', data);
    this.logger.log(`Quota warning for user ${userId}: ${data.warningType} (${data.remaining}/${data.limit})`);
  }

  // Send subscription expired notification
  sendSubscriptionExpired(userId: string, data: {
    expiredAt: Date;
  }) {
    this.server.to(`user:${userId}`).emit('subscription-expired', data);
    this.logger.log(`Subscription expired for user ${userId}`);
  }

  // ==================== Notification Events ====================

  // Send new notification to user
  sendNotification(userId: string, notification: {
    id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
    createdAt: Date;
  }) {
    this.server.to(`user:${userId}`).emit('notification:new', notification);
    this.logger.debug(`New notification sent to user ${userId}: ${notification.type}`);
  }

  // Send updated unread count to user
  sendNotificationCount(userId: string, count: number) {
    this.server.to(`user:${userId}`).emit('notification:count', { unreadCount: count });
    this.logger.debug(`Notification count updated for user ${userId}: ${count}`);
  }

  // Send notification read status update
  sendNotificationRead(userId: string, data: {
    notificationId?: string;
    allRead?: boolean;
    unreadCount: number;
  }) {
    this.server.to(`user:${userId}`).emit('notification:read', data);
  }
}
