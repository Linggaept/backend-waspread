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
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/whatsapp',
})
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WhatsAppGateway.name);

  @WebSocketServer()
  server: Server;

  // Map userId to socket IDs
  private userSockets: Map<string, Set<string>> = new Map();

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
  handleSubscribe(
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

    return { success: true };
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
}
