import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailerService } from '@nestjs-modules/mailer';
import {
  Notification,
  NotificationType,
  NotificationChannel,
} from '../../database/entities/notification.entity';
import { NotificationQueryDto } from './dto';
import { WhatsAppGateway } from '../whatsapp/gateways/whatsapp.gateway';

interface NotifyOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  channels?: NotificationChannel[];
  email?: string; // Required if email channel is included
}

interface NotificationTemplateData {
  title: string;
  message: string;
  subject: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly RETENTION_DAYS = 30;
  private readonly TIMEZONE = 'Asia/Jakarta';

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly mailerService: MailerService,
    @Inject(forwardRef(() => WhatsAppGateway))
    private readonly whatsappGateway: WhatsAppGateway,
  ) {}

  /**
   * Get current date/time in UTC
   */
  private getCurrentDate(): Date {
    return new Date();
  }

  /**
   * Get current year in UTC
   */
  private getCurrentYear(): number {
    return new Date().getUTCFullYear();
  }

  /**
   * Create and send a notification
   */
  async notify(options: NotifyOptions): Promise<Notification> {
    const channels = options.channels || [NotificationChannel.IN_APP];

    // Create notification record
    const notification = this.notificationRepository.create({
      userId: options.userId,
      type: options.type,
      title: options.title,
      message: options.message,
      data: options.data,
      channels,
      isRead: false,
      emailSent: false,
    });

    await this.notificationRepository.save(notification);

    // Send email if channel includes email
    if (channels.includes(NotificationChannel.EMAIL) && options.email) {
      await this.sendEmailNotification(notification, options.email);
    }

    // Send WebSocket notification if channel includes WEBSOCKET or IN_APP
    if (
      channels.includes(NotificationChannel.WEBSOCKET) ||
      channels.includes(NotificationChannel.IN_APP)
    ) {
      // Send real-time notification
      this.whatsappGateway.sendNotification(options.userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data as Record<string, unknown>,
        createdAt: notification.createdAt,
      });

      // Also update unread count
      const unreadCount = await this.getUnreadCount(options.userId);
      this.whatsappGateway.sendNotificationCount(options.userId, unreadCount);
    }

    this.logger.log(
      `Notification created: ${options.type} for user ${options.userId}`,
    );
    return notification;
  }

  /**
   * Get notification templates based on type
   */
  getTemplate(
    type: NotificationType,
    data?: Record<string, any>,
  ): NotificationTemplateData {
    const templates: Record<NotificationType, NotificationTemplateData> = {
      // Account
      [NotificationType.WELCOME]: {
        title: 'Selamat Datang di Waspread!',
        message: `Halo ${data?.name || 'User'}! Akun Anda telah berhasil dibuat. Mulai kirim pesan WhatsApp massal dengan mudah.`,
        subject: 'Selamat Datang di Waspread!',
      },
      [NotificationType.PASSWORD_CHANGED]: {
        title: 'Password Berhasil Diubah',
        message:
          'Password akun Anda telah berhasil diubah. Jika Anda tidak melakukan ini, segera hubungi support.',
        subject: 'Password Anda Telah Diubah',
      },

      // Subscription
      [NotificationType.SUBSCRIPTION_ACTIVATED]: {
        title: 'Langganan Aktif!',
        message: `Paket ${data?.packageName || ''} Anda telah aktif. Kuota: ${data?.quota || 0} pesan. Berlaku hingga ${data?.expiredAt || ''}.`,
        subject: 'Langganan Anda Telah Aktif',
      },
      [NotificationType.SUBSCRIPTION_EXPIRING]: {
        title: 'Langganan Akan Segera Berakhir',
        message: `Langganan Anda akan berakhir dalam ${data?.daysLeft || 3} hari. Perpanjang sekarang untuk tetap dapat mengirim pesan.`,
        subject: 'Langganan Anda Akan Segera Berakhir',
      },
      [NotificationType.SUBSCRIPTION_EXPIRED]: {
        title: 'Langganan Telah Berakhir',
        message:
          'Langganan Anda telah berakhir. Perpanjang sekarang untuk melanjutkan pengiriman pesan.',
        subject: 'Langganan Anda Telah Berakhir',
      },
      [NotificationType.QUOTA_LOW]: {
        title: 'Kuota Hampir Habis',
        message: `Kuota pesan Anda tersisa ${data?.remaining || 0} dari ${data?.total || 0}. Upgrade paket untuk menambah kuota.`,
        subject: 'Kuota Pesan Hampir Habis',
      },
      [NotificationType.QUOTA_DEPLETED]: {
        title: 'Kuota Habis!',
        message:
          'Kuota pesan Anda telah habis. Upgrade paket atau tunggu periode berikutnya untuk melanjutkan.',
        subject: 'Kuota Pesan Anda Telah Habis',
      },

      // Payment
      [NotificationType.PAYMENT_SUCCESS]: {
        title: 'Pembayaran Berhasil!',
        message: `Pembayaran untuk paket ${data?.packageName || ''} sebesar Rp ${data?.amount?.toLocaleString('id-ID') || 0} telah berhasil.`,
        subject: 'Pembayaran Berhasil',
      },
      [NotificationType.PAYMENT_FAILED]: {
        title: 'Pembayaran Gagal',
        message: `Pembayaran untuk paket ${data?.packageName || ''} gagal diproses. Silakan coba lagi.`,
        subject: 'Pembayaran Gagal',
      },
      [NotificationType.PAYMENT_PENDING]: {
        title: 'Menunggu Pembayaran',
        message: `Pembayaran untuk paket ${data?.packageName || ''} menunggu konfirmasi. Segera selesaikan pembayaran Anda.`,
        subject: 'Menunggu Pembayaran',
      },

      // WhatsApp
      [NotificationType.SESSION_CONNECTED]: {
        title: 'WhatsApp Terhubung',
        message: `WhatsApp dengan nomor ${data?.phoneNumber || ''} telah terhubung dan siap digunakan.`,
        subject: 'WhatsApp Berhasil Terhubung',
      },
      [NotificationType.SESSION_DISCONNECTED]: {
        title: 'WhatsApp Terputus',
        message:
          'Sesi WhatsApp Anda telah terputus. Silakan hubungkan kembali untuk melanjutkan.',
        subject: 'WhatsApp Terputus',
      },
      [NotificationType.SESSION_EXPIRED]: {
        title: 'Sesi WhatsApp Expired',
        message:
          'Sesi WhatsApp Anda telah kedaluwarsa. Silakan scan QR code baru untuk menghubungkan kembali.',
        subject: 'Sesi WhatsApp Kedaluwarsa',
      },

      // Blast
      [NotificationType.BLAST_STARTED]: {
        title: 'Blast Dimulai',
        message: `Kampanye "${data?.blastName || ''}" telah dimulai. Total ${data?.totalRecipients || 0} penerima.`,
        subject: 'Kampanye Blast Dimulai',
      },
      [NotificationType.BLAST_COMPLETED]: {
        title: 'Blast Selesai',
        message: `Kampanye "${data?.blastName || ''}" telah selesai. Terkirim: ${data?.sent || 0}, Gagal: ${data?.failed || 0}, Invalid: ${data?.invalid || 0}.`,
        subject: 'Kampanye Blast Selesai',
      },
      [NotificationType.BLAST_FAILED]: {
        title: 'Blast Gagal',
        message: `Kampanye "${data?.blastName || ''}" gagal diproses. ${data?.reason || 'Silakan coba lagi.'}`,
        subject: 'Kampanye Blast Gagal',
      },
      [NotificationType.BLAST_REPLY]: {
        title: 'Balasan Baru',
        message: `Anda menerima balasan dari ${data?.phoneNumber || ''}: "${data?.preview || ''}"`,
        subject: 'Anda Menerima Balasan Baru',
      },
    };

    return (
      templates[type] || {
        title: 'Notifikasi',
        message: 'Anda memiliki notifikasi baru.',
        subject: 'Notifikasi Baru',
      }
    );
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    notification: Notification,
    email: string,
  ): Promise<void> {
    try {
      const template = this.getTemplate(notification.type, notification.data);

      await this.mailerService.sendMail({
        to: email,
        subject: template.subject,
        html: this.getEmailTemplate(notification, template),
      });

      notification.emailSent = true;
      await this.notificationRepository.save(notification);

      this.logger.log(
        `Email notification sent to ${email} for type ${notification.type}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send email notification: ${error}`);
    }
  }

  /**
   * Get HTML email template
   */
  private getEmailTemplate(
    notification: Notification,
    template: NotificationTemplateData,
  ): string {
    const typeColors: Record<string, string> = {
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
    };

    const getTypeColor = (type: NotificationType): string => {
      if (
        [
          NotificationType.PAYMENT_SUCCESS,
          NotificationType.SUBSCRIPTION_ACTIVATED,
          NotificationType.BLAST_COMPLETED,
          NotificationType.SESSION_CONNECTED,
        ].includes(type)
      ) {
        return typeColors.success;
      }
      if (
        [
          NotificationType.SUBSCRIPTION_EXPIRING,
          NotificationType.QUOTA_LOW,
          NotificationType.PAYMENT_PENDING,
        ].includes(type)
      ) {
        return typeColors.warning;
      }
      if (
        [
          NotificationType.PAYMENT_FAILED,
          NotificationType.BLAST_FAILED,
          NotificationType.SESSION_EXPIRED,
          NotificationType.QUOTA_DEPLETED,
          NotificationType.SUBSCRIPTION_EXPIRED,
        ].includes(type)
      ) {
        return typeColors.error;
      }
      return typeColors.info;
    };

    const accentColor = getTypeColor(notification.type);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.subject}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 10px; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { font-size: 28px; font-weight: bold; color: #22c55e; }
    .title { font-size: 24px; color: ${accentColor}; margin: 20px 0; text-align: center; }
    .message { color: #666; line-height: 1.8; text-align: center; font-size: 16px; }
    .cta-button { display: inline-block; background: ${accentColor}; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; margin-top: 20px; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo">🚀 Waspread</div>
      </div>

      <h1 class="title">${template.title}</h1>
      <p class="message">${notification.message}</p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env.FRONTEND_URL || 'https://waspread.vercel.app'}/dashboard" class="cta-button">Buka Dashboard</a>
      </div>

      <div class="footer">
        <p>© ${this.getCurrentYear()} Waspread. All rights reserved.</p>
        <p>Email ini dikirim otomatis, mohon tidak membalas email ini.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Helper methods for common notifications
   */
  async notifyWelcome(
    userId: string,
    _email: string,
    name?: string,
  ): Promise<Notification> {
    const template = this.getTemplate(NotificationType.WELCOME, { name });
    return this.notify({
      userId,
      type: NotificationType.WELCOME,
      title: template.title,
      message: template.message,
      data: { name },
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifySubscriptionActivated(
    userId: string,
    _email: string,
    packageName: string,
    quota: number,
    expiredAt: string,
  ): Promise<Notification> {
    const data = { packageName, quota, expiredAt };
    const template = this.getTemplate(
      NotificationType.SUBSCRIPTION_ACTIVATED,
      data,
    );
    return this.notify({
      userId,
      type: NotificationType.SUBSCRIPTION_ACTIVATED,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP, NotificationChannel.WEBSOCKET],
    });
  }

  async notifySubscriptionExpiring(
    userId: string,
    _email: string,
    daysLeft: number,
  ): Promise<Notification> {
    const data = { daysLeft };
    const template = this.getTemplate(
      NotificationType.SUBSCRIPTION_EXPIRING,
      data,
    );
    return this.notify({
      userId,
      type: NotificationType.SUBSCRIPTION_EXPIRING,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifySubscriptionExpired(
    userId: string,
    _email: string,
  ): Promise<Notification> {
    const template = this.getTemplate(NotificationType.SUBSCRIPTION_EXPIRED);
    return this.notify({
      userId,
      type: NotificationType.SUBSCRIPTION_EXPIRED,
      title: template.title,
      message: template.message,
      channels: [NotificationChannel.IN_APP, NotificationChannel.WEBSOCKET],
    });
  }

  async notifyQuotaLow(
    userId: string,
    remaining: number,
    total: number,
  ): Promise<Notification> {
    const data = { remaining, total };
    const template = this.getTemplate(NotificationType.QUOTA_LOW, data);
    return this.notify({
      userId,
      type: NotificationType.QUOTA_LOW,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP, NotificationChannel.WEBSOCKET],
    });
  }

  async notifyQuotaDepleted(
    userId: string,
    _email: string,
  ): Promise<Notification> {
    const template = this.getTemplate(NotificationType.QUOTA_DEPLETED);
    return this.notify({
      userId,
      type: NotificationType.QUOTA_DEPLETED,
      title: template.title,
      message: template.message,
      channels: [NotificationChannel.IN_APP, NotificationChannel.WEBSOCKET],
    });
  }

  async notifyPaymentSuccess(
    userId: string,
    _email: string,
    packageName: string,
    amount: number,
  ): Promise<Notification> {
    const data = { packageName, amount };
    const template = this.getTemplate(NotificationType.PAYMENT_SUCCESS, data);
    return this.notify({
      userId,
      type: NotificationType.PAYMENT_SUCCESS,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP, NotificationChannel.WEBSOCKET],
    });
  }

  async notifyPaymentFailed(
    userId: string,
    _email: string,
    packageName: string,
  ): Promise<Notification> {
    const data = { packageName };
    const template = this.getTemplate(NotificationType.PAYMENT_FAILED, data);
    return this.notify({
      userId,
      type: NotificationType.PAYMENT_FAILED,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifyBlastCompleted(
    userId: string,
    _email: string,
    blastName: string,
    sent: number,
    failed: number,
    invalid: number,
  ): Promise<Notification> {
    const data = { blastName, sent, failed, invalid };
    const template = this.getTemplate(NotificationType.BLAST_COMPLETED, data);
    return this.notify({
      userId,
      type: NotificationType.BLAST_COMPLETED,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifyBlastFailed(
    userId: string,
    _email: string,
    blastName: string,
    reason?: string,
  ): Promise<Notification> {
    const data = { blastName, reason };
    const template = this.getTemplate(NotificationType.BLAST_FAILED, data);
    return this.notify({
      userId,
      type: NotificationType.BLAST_FAILED,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifyBlastReply(
    userId: string,
    phoneNumber: string,
    preview: string,
  ): Promise<Notification> {
    const data = { phoneNumber, preview: preview.substring(0, 50) };
    const template = this.getTemplate(NotificationType.BLAST_REPLY, data);
    return this.notify({
      userId,
      type: NotificationType.BLAST_REPLY,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifySessionConnected(
    userId: string,
    phoneNumber: string,
  ): Promise<Notification> {
    const data = { phoneNumber };
    const template = this.getTemplate(NotificationType.SESSION_CONNECTED, data);
    return this.notify({
      userId,
      type: NotificationType.SESSION_CONNECTED,
      title: template.title,
      message: template.message,
      data,
      channels: [NotificationChannel.IN_APP],
    });
  }

  async notifySessionDisconnected(userId: string): Promise<Notification> {
    const template = this.getTemplate(NotificationType.SESSION_DISCONNECTED);
    return this.notify({
      userId,
      type: NotificationType.SESSION_DISCONNECTED,
      title: template.title,
      message: template.message,
      channels: [NotificationChannel.IN_APP],
    });
  }

  /**
   * Query methods
   */
  async findByUser(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<{ data: Notification[]; total: number; unreadCount: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.notificationRepository.createQueryBuilder('notification');
    qb.where('notification.userId = :userId', { userId });

    if (query.isRead !== undefined) {
      const isRead = query.isRead === 'true';
      qb.andWhere('notification.isRead = :isRead', { isRead });
    }

    if (query.type) {
      qb.andWhere('notification.type = :type', { type: query.type });
    }

    qb.orderBy('notification.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    // Get unread count
    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });

    return { data, total, unreadCount };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.isRead = true;
    notification.readAt = this.getCurrentDate();
    const saved = await this.notificationRepository.save(notification);

    // Send WebSocket update
    const unreadCount = await this.getUnreadCount(userId);
    this.whatsappGateway.sendNotificationRead(userId, {
      notificationId,
      unreadCount,
    });

    return saved;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true, readAt: this.getCurrentDate() },
    );

    // Send WebSocket update
    this.whatsappGateway.sendNotificationRead(userId, {
      allRead: true,
      unreadCount: 0,
    });
  }

  async delete(userId: string, notificationId: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.notificationRepository.remove(notification);
  }

  /**
   * Cleanup old notifications (runs daily at midnight)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldNotifications(): Promise<void> {
    const cutoffDate = this.getCurrentDate();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

    const result = await this.notificationRepository.delete({
      createdAt: LessThan(cutoffDate),
    });

    if (result.affected && result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} old notifications`);
    }
  }
}
