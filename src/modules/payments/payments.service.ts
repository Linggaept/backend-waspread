import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as Midtrans from 'midtrans-client';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { PackagesService } from '../packages/packages.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreatePaymentDto, MidtransNotificationDto } from './dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private snap: Midtrans.Snap;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly configService: ConfigService,
    private readonly packagesService: PackagesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    this.snap = new Midtrans.Snap({
      isProduction: this.configService.get<boolean>('midtrans.isProduction'),
      serverKey: this.configService.get<string>('midtrans.serverKey'),
      clientKey: this.configService.get<string>('midtrans.clientKey'),
    });
  }

  async createPayment(
    userId: string,
    userEmail: string,
    createPaymentDto: CreatePaymentDto,
  ): Promise<{ payment: Payment; snapToken: string; redirectUrl: string }> {
    // Get package
    const pkg = await this.packagesService.findOne(createPaymentDto.packageId);
    if (!pkg.isActive) {
      throw new BadRequestException('This package is not available');
    }

    // Generate unique order ID
    const orderId = `WS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
    } catch (error) {
      this.logger.error('Failed to create Midtrans transaction', error);
      payment.status = PaymentStatus.FAILED;
      await this.paymentRepository.save(payment);
      throw new BadRequestException('Failed to create payment');
    }
  }

  async handleNotification(notification: MidtransNotificationDto): Promise<void> {
    const { order_id, transaction_status, fraud_status, transaction_id, payment_type } = notification;

    this.logger.log(`Received notification for order: ${order_id}, status: ${transaction_status}`);

    const payment = await this.paymentRepository.findOne({
      where: { orderId: order_id },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for order: ${order_id}`);
      return;
    }

    // Update payment info
    if (transaction_id) {
      payment.transactionId = transaction_id;
    }
    if (payment_type) {
      payment.paymentType = payment_type;
    }
    payment.midtransResponse = notification as unknown as Record<string, unknown>;

    // Determine payment status
    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      if (fraud_status === 'accept' || !fraud_status) {
        payment.status = PaymentStatus.SUCCESS;
        payment.paidAt = new Date();

        // Activate subscription
        await this.subscriptionsService.activateSubscription(
          payment.userId,
          payment.packageId,
          payment.id,
        );
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
    this.logger.log(`Payment ${order_id} updated to status: ${payment.status}`);
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

  async findAll(): Promise<Payment[]> {
    return this.paymentRepository.find({
      relations: ['package', 'user'],
      order: { createdAt: 'DESC' },
    });
  }
}
