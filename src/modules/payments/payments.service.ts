import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as Midtrans from 'midtrans-client';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { PackagesService } from '../packages/packages.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  CreatePaymentDto,
  MidtransNotificationDto,
  PaymentQueryDto,
} from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../../database/entities/user.entity';
import { AiTokenService } from '../ai/services/ai-token.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private snap: Midtrans.Snap;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly packagesService: PackagesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => AiTokenService))
    private readonly aiTokenService: AiTokenService,
  ) {
    // Try both methods to get the key
    const serverKey =
      this.configService.get<string>('midtrans.serverKey') ||
      process.env.MIDTRANS_SERVER_KEY;
    const clientKey =
      this.configService.get<string>('midtrans.clientKey') ||
      process.env.MIDTRANS_CLIENT_KEY;

    // Use nullish coalescing for boolean to properly handle false value
    const configIsProduction = this.configService.get<boolean>(
      'midtrans.isProduction',
    );
    const isProduction =
      configIsProduction !== undefined
        ? configIsProduction
        : process.env.MIDTRANS_IS_PRODUCTION === 'true';

    // Debug: Check both sources
    this.logger.log(
      `ConfigService serverKey: ${this.configService.get<string>('midtrans.serverKey')?.substring(0, 15) || 'UNDEFINED'}`,
    );
    this.logger.log(
      `ConfigService isProduction: ${this.configService.get<boolean>('midtrans.isProduction')}`,
    );
    this.logger.log(
      `process.env MIDTRANS_IS_PRODUCTION: "${process.env.MIDTRANS_IS_PRODUCTION}"`,
    );
    this.logger.log(`Final isProduction: ${isProduction}`);

    if (!serverKey || !clientKey) {
      this.logger.warn(
        'Midtrans keys not configured. Payment features will not work.',
      );
    } else {
      // Log partial key for debugging (first 20 chars only)
      const maskedServerKey = serverKey.substring(0, 20) + '...';
      const maskedClientKey = clientKey.substring(0, 20) + '...';
      this.logger.log(
        `Midtrans initialized (${isProduction ? 'PRODUCTION' : 'SANDBOX'} mode)`,
      );
      this.logger.log(
        `Server Key: ${maskedServerKey} (length: ${serverKey.length})`,
      );
      this.logger.log(
        `Client Key: ${maskedClientKey} (length: ${clientKey.length})`,
      );
    }

    // Log the exact value being passed to Midtrans
    const finalIsProduction = Boolean(isProduction);
    this.logger.log(
      `[CONSTRUCTOR] Passing to Midtrans.Snap: isProduction=${finalIsProduction} (type: ${typeof finalIsProduction})`,
    );

    this.snap = new Midtrans.Snap({
      isProduction: finalIsProduction,
      serverKey: serverKey,
      clientKey: clientKey,
    });

    // Verify what Midtrans actually stored
    this.logger.log(
      `[CONSTRUCTOR] Midtrans.Snap stored: isProduction=${(this.snap as any).apiConfig?.isProduction}`,
    );
  }

  async createPayment(
    userId: string,
    userEmail: string,
    createPaymentDto: CreatePaymentDto,
  ): Promise<{ payment: Payment; snapToken: string; redirectUrl: string }> {
    // Debug: Log which key is being used
    const configKey = this.configService.get<string>('midtrans.serverKey');
    const envKey = process.env.MIDTRANS_SERVER_KEY;
    this.logger.log(
      `[DEBUG] ConfigService key: ${configKey?.substring(0, 25) || 'NULL'}`,
    );
    this.logger.log(
      `[DEBUG] process.env key: ${envKey?.substring(0, 25) || 'NULL'}`,
    );

    // Check Midtrans configuration
    const serverKey = configKey || envKey;
    if (!serverKey) {
      throw new BadRequestException(
        'Payment gateway not configured. Please contact administrator.',
      );
    }

    // Get package
    const pkg = await this.packagesService.findOne(createPaymentDto.packageId);
    if (!pkg.isActive) {
      throw new BadRequestException('This package is not available');
    }
    if (!pkg.isPurchasable) {
      throw new BadRequestException(
        'This package is not available for purchase',
      );
    }

    // FIX: Check if user already has a PENDING payment for this package (prevent double-click)
    const existingPendingPayment = await this.paymentRepository.findOne({
      where: {
        userId,
        packageId: pkg.id,
        status: PaymentStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (existingPendingPayment) {
      // Check if the pending payment is less than 30 minutes old (Midtrans token validity)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      if (existingPendingPayment.createdAt > thirtyMinutesAgo && existingPendingPayment.snapToken) {
        this.logger.log(
          `Returning existing pending payment for user ${userId}, package ${pkg.id}`,
        );
        // Return existing payment instead of creating new one
        return {
          payment: existingPendingPayment,
          snapToken: existingPendingPayment.snapToken,
          redirectUrl: `https://app.${this.configService.get<boolean>('midtrans.isProduction') ? '' : 'sandbox.'}midtrans.com/snap/v2/vtweb/${existingPendingPayment.snapToken}`,
        };
      }
      // If older than 30 minutes, mark as expired
      existingPendingPayment.status = PaymentStatus.EXPIRED;
      await this.paymentRepository.save(existingPendingPayment);
    }

    // Generate unique order ID using crypto for better randomness
    const orderId = `WS-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

    // Create payment record
    const payment = this.paymentRepository.create({
      orderId,
      userId,
      packageId: pkg.id,
      amount: pkg.price,
      status: PaymentStatus.PENDING,
    });

    await this.paymentRepository.save(payment);

    // Create Midtrans transaction
    const transactionDetails = {
      order_id: orderId,
      gross_amount: Number(pkg.price),
    };

    const customerDetails = {
      email: userEmail,
    };

    const itemDetails = [
      {
        id: pkg.id,
        price: Number(pkg.price),
        quantity: 1,
        name: `${pkg.name} - ${pkg.durationDays} Days`,
      },
    ];

    try {
      // Debug: Log snap config
      this.logger.log(
        `[DEBUG] Snap apiConfig: ${JSON.stringify({
          serverKey:
            (this.snap as any).apiConfig?.serverKey?.substring(0, 25) || 'NULL',
          isProduction: (this.snap as any).apiConfig?.isProduction,
        })}`,
      );

      const snapResponse = await this.snap.createTransaction({
        transaction_details: transactionDetails,
        customer_details: customerDetails,
        item_details: itemDetails,
      });

      // Update payment with snap token
      payment.snapToken = snapResponse.token;
      await this.paymentRepository.save(payment);

      return {
        payment,
        snapToken: snapResponse.token,
        redirectUrl: snapResponse.redirect_url,
      };
    } catch (error: any) {
      // Log detailed error from Midtrans
      const errorMessage = error?.message || String(error);
      const errorResponse =
        error?.ApiResponse || error?.httpStatusCode || 'No response';
      this.logger.error(
        `Failed to create Midtrans transaction: ${errorMessage}`,
        {
          errorResponse,
          orderId,
          packageId: pkg.id,
          amount: pkg.price,
        },
      );

      payment.status = PaymentStatus.FAILED;
      await this.paymentRepository.save(payment);

      // Return more helpful error message
      throw new BadRequestException(
        `Failed to create payment: ${errorMessage}. Please check Midtrans configuration.`,
      );
    }
  }

  async handleNotification(
    notification: MidtransNotificationDto,
  ): Promise<void> {
    const {
      order_id,
      transaction_status,
      fraud_status,
      transaction_id,
      payment_type,
      status_code,
      gross_amount,
      signature_key,
    } = notification;

    this.logger.log(
      `Received notification for order: ${order_id}, status: ${transaction_status}`,
    );

    // Check if this is a token purchase (TKN- prefix)
    if (order_id.startsWith('TKN-')) {
      this.logger.log(`[TOKEN] Delegating to AiTokenService for ${order_id}`);
      const result = await this.aiTokenService.handleNotification(notification);
      if (result.handled) {
        this.logger.log(
          `[TOKEN] Successfully handled token purchase: ${order_id}`,
        );
        return;
      }
    }

    // Verify signature hash from Midtrans
    const serverKey = this.configService.get<string>('midtrans.serverKey');
    const expectedHash = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
      .digest('hex');

    if (expectedHash !== signature_key) {
      this.logger.warn(`Invalid Midtrans signature for order: ${order_id}`);
      throw new UnauthorizedException('Invalid signature');
    }

    const payment = await this.paymentRepository.findOne({
      where: { orderId: order_id },
      relations: ['package'],
    });

    if (!payment) {
      this.logger.warn(`Payment not found for order: ${order_id}`);
      return;
    }

    // Get user for notification
    const user = await this.userRepository.findOne({
      where: { id: payment.userId },
    });

    // Update payment info
    if (transaction_id) {
      payment.transactionId = transaction_id;
    }
    if (payment_type) {
      payment.paymentType = payment_type;
    }
    payment.midtransResponse = notification as unknown as Record<
      string,
      unknown
    >;

    // FIX: Store previous status to check for idempotency
    const previousStatus = payment.status;

    // Determine payment status
    if (
      transaction_status === 'capture' ||
      transaction_status === 'settlement'
    ) {
      if (fraud_status === 'accept' || !fraud_status) {
        payment.status = PaymentStatus.SUCCESS;
        payment.paidAt = new Date();

        // FIX: Only activate subscription if payment was NOT already SUCCESS (idempotent webhook)
        if (previousStatus !== PaymentStatus.SUCCESS) {
          this.logger.log(
            `Activating subscription for payment ${order_id} (previous status: ${previousStatus})`,
          );
          await this.subscriptionsService.activateSubscription(
            payment.userId,
            payment.packageId,
            payment.id,
          );
        } else {
          this.logger.log(
            `Skipping subscription activation for ${order_id} - already processed (status was: ${previousStatus})`,
          );
        }
      } else {
        payment.status = PaymentStatus.FAILED;
      }
    } else if (transaction_status === 'pending') {
      payment.status = PaymentStatus.PENDING;
    } else if (
      transaction_status === 'deny' ||
      transaction_status === 'cancel' ||
      transaction_status === 'failure'
    ) {
      payment.status = PaymentStatus.FAILED;
    } else if (transaction_status === 'expire') {
      payment.status = PaymentStatus.EXPIRED;
    }

    await this.paymentRepository.save(payment);
    this.logger.log(`Payment ${order_id} updated to status: ${payment.status} (was: ${previousStatus})`);

    // Send notifications based on payment status
    if (user && payment.package) {
      if (payment.status === PaymentStatus.SUCCESS) {
        this.notificationsService
          .notifyPaymentSuccess(
            payment.userId,
            user.email,
            payment.package.name,
            Number(payment.amount),
          )
          .catch((err) =>
            this.logger.error(
              'Failed to send payment success notification:',
              err,
            ),
          );
      } else if (payment.status === PaymentStatus.FAILED) {
        this.notificationsService
          .notifyPaymentFailed(payment.userId, user.email, payment.package.name)
          .catch((err) =>
            this.logger.error(
              'Failed to send payment failed notification:',
              err,
            ),
          );
      }
    }
  }

  async findByUser(userId: string): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { userId },
      relations: ['package'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id },
      relations: ['package', 'user'],
    });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return payment;
  }

  async findAll(
    query?: PaymentQueryDto,
  ): Promise<{ data: Payment[]; total: number }> {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      sortBy = 'createdAt',
      order = 'DESC',
    } = query || {};

    const qb = this.paymentRepository.createQueryBuilder('payment');
    qb.leftJoinAndSelect('payment.package', 'package');
    qb.leftJoinAndSelect('payment.user', 'user');

    if (status) {
      qb.andWhere('payment.status = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(user.email ILIKE :search OR payment.orderId ILIKE :search OR payment.transactionId ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy(`payment.${sortBy}`, order as 'ASC' | 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }
}
