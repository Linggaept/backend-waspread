import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as Midtrans from 'midtrans-client';
import { User } from '../../../database/entities/user.entity';
import { AiTokenPackage } from '../../../database/entities/ai-token-package.entity';
import {
  AiTokenPurchase,
  AiTokenPurchaseStatus,
} from '../../../database/entities/ai-token-purchase.entity';
import {
  AiTokenUsage,
  AiFeatureType,
  AI_FEATURE_TOKEN_COST,
} from '../../../database/entities/ai-token-usage.entity';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';

@Injectable()
export class AiTokenService implements OnModuleInit {
  private readonly logger = new Logger(AiTokenService.name);
  private snap: Midtrans.Snap;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AiTokenPackage)
    private readonly packageRepository: Repository<AiTokenPackage>,
    @InjectRepository(AiTokenPurchase)
    private readonly purchaseRepository: Repository<AiTokenPurchase>,
    @InjectRepository(AiTokenUsage)
    private readonly usageRepository: Repository<AiTokenUsage>,
    private readonly whatsAppGateway: WhatsAppGateway,
    private readonly configService: ConfigService,
  ) {
    // Initialize Midtrans Snap
    const serverKey =
      this.configService.get<string>('midtrans.serverKey') ||
      process.env.MIDTRANS_SERVER_KEY;
    const clientKey =
      this.configService.get<string>('midtrans.clientKey') ||
      process.env.MIDTRANS_CLIENT_KEY;
    const configIsProduction = this.configService.get<boolean>(
      'midtrans.isProduction',
    );
    const isProduction =
      configIsProduction !== undefined
        ? configIsProduction
        : process.env.MIDTRANS_IS_PRODUCTION === 'true';

    if (!serverKey || !clientKey) {
      this.logger.warn(
        '[AI-TOKEN] Midtrans keys not configured. Token purchase will not work.',
      );
    } else {
      this.logger.log(
        `[AI-TOKEN] Midtrans initialized (${isProduction ? 'PRODUCTION' : 'SANDBOX'} mode)`,
      );
    }

    this.snap = new Midtrans.Snap({
      isProduction: Boolean(isProduction),
      serverKey: serverKey,
      clientKey: clientKey,
    });
  }

  async onModuleInit(): Promise<void> {
    // Seed default packages if none exist
    await this.seedDefaultPackages();
  }

  // ==================== Token Cost Helpers ====================

  /**
   * Get token cost for a specific AI feature
   */
  getFeatureTokenCost(feature: AiFeatureType): number {
    return AI_FEATURE_TOKEN_COST[feature] || 1;
  }

  /**
   * Get all feature token costs (for frontend display)
   */
  getAllFeatureTokenCosts(): Record<AiFeatureType, number> {
    return { ...AI_FEATURE_TOKEN_COST };
  }

  // ==================== Token Balance ====================

  async getBalance(userId: string): Promise<{
    balance: number;
    totalPurchased: number;
    totalUsed: number;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get total tokens purchased (successful only)
    const purchasedResult = await this.purchaseRepository
      .createQueryBuilder('p')
      .select('SUM(p.tokenAmount)', 'total')
      .where('p.userId = :userId', { userId })
      .andWhere('p.status = :status', { status: AiTokenPurchaseStatus.SUCCESS })
      .getRawOne();

    // Get total tokens used
    const usedResult = await this.usageRepository
      .createQueryBuilder('u')
      .select('SUM(u.tokensUsed)', 'total')
      .where('u.userId = :userId', { userId })
      .getRawOne();

    return {
      balance: Number(user.aiTokenBalance) || 0,
      totalPurchased: parseFloat(purchasedResult?.total || '0'),
      totalUsed: parseFloat(usedResult?.total || '0'),
    };
  }

  /**
   * Check if user has enough tokens for a feature or specific amount
   * @param userId - User ID
   * @param featureOrAmount - AiFeatureType to auto-calculate, or number for explicit amount
   */
  async checkBalance(
    userId: string,
    featureOrAmount: AiFeatureType | number = 1,
  ): Promise<{
    hasEnough: boolean;
    balance: number;
    required: number;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Auto-calculate cost if feature type is provided
    const required =
      typeof featureOrAmount === 'number'
        ? featureOrAmount
        : this.getFeatureTokenCost(featureOrAmount);

    const balance = Number(user.aiTokenBalance) || 0;

    return {
      hasEnough: balance >= required,
      balance,
      required,
    };
  }

  /**
   * Use tokens for an AI feature
   * @param userId - User ID
   * @param feature - AI feature type (cost auto-calculated from AI_FEATURE_TOKEN_COST)
   * @param amount - Override token amount (optional, defaults to feature cost)
   * @param referenceId - Reference ID for tracking (e.g., auto-reply log ID)
   * @param metadata - Additional metadata
   */
  async useTokens(
    userId: string,
    feature: AiFeatureType,
    amount?: number,
    referenceId?: string,
    metadata?: Record<string, any>,
  ): Promise<{ success: boolean; newBalance: number; tokensUsed: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Auto-calculate cost based on feature if amount not provided
    const tokensToUse = amount ?? this.getFeatureTokenCost(feature);

    // Ensure we're working with numbers (decimal columns return strings)
    const currentBalance = Number(user.aiTokenBalance) || 0;

    if (currentBalance < tokensToUse) {
      throw new ForbiddenException(
        `Insufficient AI tokens. Required: ${tokensToUse}, Available: ${currentBalance}`,
      );
    }

    // Deduct balance (round to 2 decimal places to avoid floating point issues)
    user.aiTokenBalance = Math.round((currentBalance - tokensToUse) * 100) / 100;
    await this.userRepository.save(user);

    // Record usage
    const usage = this.usageRepository.create({
      userId,
      feature,
      tokensUsed: tokensToUse,
      referenceId: referenceId || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    await this.usageRepository.save(usage);

    this.logger.log(
      `[AI-TOKEN] User ${userId} used ${tokensToUse} token(s) for ${feature}. New balance: ${user.aiTokenBalance}`,
    );

    // Emit balance update via WebSocket
    this.whatsAppGateway.sendAiTokenUpdate(userId, {
      balance: user.aiTokenBalance,
      lastUsage: {
        feature,
        amount: tokensToUse,
        timestamp: new Date(),
      },
    });

    return {
      success: true,
      newBalance: user.aiTokenBalance,
      tokensUsed: tokensToUse,
    };
  }

  async addTokens(
    userId: string,
    amount: number,
    reason?: string,
  ): Promise<{ success: boolean; newBalance: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Ensure we're working with numbers (decimal columns return strings)
    const currentBalance = Number(user.aiTokenBalance) || 0;
    const amountToAdd = Number(amount) || 0;
    user.aiTokenBalance = Math.round((currentBalance + amountToAdd) * 100) / 100;
    await this.userRepository.save(user);

    this.logger.log(
      `[AI-TOKEN] Added ${amount} tokens to user ${userId}. Reason: ${reason || 'N/A'}. New balance: ${user.aiTokenBalance}`,
    );

    // Emit balance update via WebSocket
    this.whatsAppGateway.sendAiTokenUpdate(userId, {
      balance: user.aiTokenBalance,
      added: amount,
      reason,
    });

    return {
      success: true,
      newBalance: user.aiTokenBalance,
    };
  }

  // ==================== Packages ====================

  async getPackages(): Promise<AiTokenPackage[]> {
    return this.packageRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async getPackage(id: string): Promise<AiTokenPackage> {
    const pkg = await this.packageRepository.findOne({ where: { id } });
    if (!pkg) {
      throw new NotFoundException('Token package not found');
    }
    return pkg;
  }

  /**
   * Seed default token packages if none exist
   * Called on module initialization
   */
  async seedDefaultPackages(): Promise<void> {
    const existingCount = await this.packageRepository.count();
    if (existingCount > 0) {
      this.logger.debug('[AI-TOKEN] Packages already exist, skipping seed');
      return;
    }

    const defaultPackages = [
      {
        name: 'Starter',
        description: 'Paket pemula untuk mencoba fitur AI',
        tokenAmount: 50,
        bonusTokens: 0,
        price: 25000,
        isPopular: false,
        sortOrder: 1,
      },
      {
        name: 'Basic',
        description: 'Paket hemat untuk pengguna reguler',
        tokenAmount: 100,
        bonusTokens: 10,
        price: 45000,
        isPopular: false,
        sortOrder: 2,
      },
      {
        name: 'Pro',
        description: 'Paket terpopuler dengan bonus ekstra',
        tokenAmount: 250,
        bonusTokens: 30,
        price: 100000,
        isPopular: true,
        sortOrder: 3,
      },
      {
        name: 'Business',
        description: 'Untuk bisnis dengan volume tinggi',
        tokenAmount: 500,
        bonusTokens: 75,
        price: 175000,
        isPopular: false,
        sortOrder: 4,
      },
      {
        name: 'Enterprise',
        description: 'Paket terbaik dengan diskon maksimal',
        tokenAmount: 1000,
        bonusTokens: 200,
        price: 300000,
        isPopular: false,
        sortOrder: 5,
      },
    ];

    for (const pkg of defaultPackages) {
      const entity = this.packageRepository.create(pkg);
      await this.packageRepository.save(entity);
    }

    this.logger.log(
      `[AI-TOKEN] Seeded ${defaultPackages.length} default token packages`,
    );
  }

  // Admin: Create package
  async createPackage(data: Partial<AiTokenPackage>): Promise<AiTokenPackage> {
    const pkg = this.packageRepository.create(data);
    return this.packageRepository.save(pkg);
  }

  // Admin: Update package
  async updatePackage(
    id: string,
    data: Partial<AiTokenPackage>,
  ): Promise<AiTokenPackage> {
    const pkg = await this.getPackage(id);
    Object.assign(pkg, data);
    return this.packageRepository.save(pkg);
  }

  // Admin: Delete package
  async deletePackage(id: string): Promise<void> {
    const pkg = await this.getPackage(id);
    await this.packageRepository.remove(pkg);
  }

  // ==================== Purchases ====================

  async createPurchase(
    userId: string,
    userEmail: string,
    packageId: string,
  ): Promise<{
    purchase: AiTokenPurchase;
    snapToken: string;
    redirectUrl: string;
  }> {
    const pkg = await this.getPackage(packageId);

    if (!pkg.isActive) {
      throw new BadRequestException('This token package is not available');
    }

    // Check for existing pending purchase (prevent double-click)
    const existingPending = await this.purchaseRepository.findOne({
      where: {
        userId,
        packageId,
        status: AiTokenPurchaseStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (existingPending) {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      if (existingPending.createdAt > thirtyMinutesAgo && existingPending.snapToken) {
        this.logger.log(
          `[AI-TOKEN] Returning existing pending purchase for user ${userId}`,
        );
        const isProduction = this.configService.get<boolean>('midtrans.isProduction');
        return {
          purchase: existingPending,
          snapToken: existingPending.snapToken,
          redirectUrl: `https://app.${isProduction ? '' : 'sandbox.'}midtrans.com/snap/v2/vtweb/${existingPending.snapToken}`,
        };
      }
      // Expire old pending purchase
      existingPending.status = AiTokenPurchaseStatus.EXPIRED;
      await this.purchaseRepository.save(existingPending);
    }

    // Generate unique order ID with TKN prefix for token purchases
    const orderId = `TKN-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

    // Create purchase record
    const purchase = this.purchaseRepository.create({
      userId,
      packageId,
      tokenAmount: Number(pkg.tokenAmount) + Number(pkg.bonusTokens),
      price: pkg.price,
      orderId,
      status: AiTokenPurchaseStatus.PENDING,
    });

    await this.purchaseRepository.save(purchase);

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
        name: `${pkg.name} - ${Number(pkg.tokenAmount) + Number(pkg.bonusTokens)} AI Tokens`,
      },
    ];

    try {
      const snapResponse = await this.snap.createTransaction({
        transaction_details: transactionDetails,
        customer_details: customerDetails,
        item_details: itemDetails,
      });

      // Update purchase with snap token
      purchase.snapToken = snapResponse.token;
      await this.purchaseRepository.save(purchase);

      this.logger.log(
        `[AI-TOKEN] Created purchase ${orderId} for user ${userId}, package ${pkg.name}`,
      );

      return {
        purchase,
        snapToken: snapResponse.token,
        redirectUrl: snapResponse.redirect_url,
      };
    } catch (error: any) {
      this.logger.error(
        `[AI-TOKEN] Failed to create Midtrans transaction: ${error.message}`,
      );
      purchase.status = AiTokenPurchaseStatus.FAILED;
      await this.purchaseRepository.save(purchase);
      throw new BadRequestException(
        `Failed to create payment: ${error.message}`,
      );
    }
  }

  /**
   * Handle Midtrans webhook notification for token purchases
   */
  async handleNotification(notification: {
    order_id: string;
    transaction_status: string;
    fraud_status?: string;
    transaction_id?: string;
    payment_type?: string;
    status_code?: string;
    gross_amount?: string;
    signature_key?: string;
  }): Promise<{ handled: boolean; purchase?: AiTokenPurchase }> {
    const { order_id, status_code, gross_amount, signature_key } = notification;

    // Only handle token purchases (TKN- prefix)
    if (!order_id.startsWith('TKN-')) {
      return { handled: false };
    }

    // Require signature fields for verification
    if (!status_code || !gross_amount || !signature_key) {
      this.logger.warn(
        `[AI-TOKEN] Missing signature fields for order: ${order_id}`,
      );
      return { handled: false };
    }

    // Verify signature
    const serverKey = this.configService.get<string>('midtrans.serverKey');
    const expectedHash = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
      .digest('hex');

    if (expectedHash !== signature_key) {
      this.logger.warn(`[AI-TOKEN] Invalid signature for order: ${order_id}`);
      throw new UnauthorizedException('Invalid signature');
    }

    const purchase = await this.purchaseRepository.findOne({
      where: { orderId: order_id },
      relations: ['package'],
    });

    if (!purchase) {
      this.logger.warn(`[AI-TOKEN] Purchase not found for order: ${order_id}`);
      return { handled: true };
    }

    const previousStatus = purchase.status;

    // Update transaction info
    if (notification.transaction_id) {
      purchase.transactionId = notification.transaction_id;
    }
    if (notification.payment_type) {
      purchase.paymentType = notification.payment_type;
    }

    // Determine status
    const { transaction_status, fraud_status } = notification;

    if (
      transaction_status === 'capture' ||
      transaction_status === 'settlement'
    ) {
      if (fraud_status === 'accept' || !fraud_status) {
        purchase.status = AiTokenPurchaseStatus.SUCCESS;
        purchase.completedAt = new Date();

        // Only add tokens if not already processed (idempotent)
        if (previousStatus !== AiTokenPurchaseStatus.SUCCESS) {
          const tokenAmountNum = Number(purchase.tokenAmount) || 0;
          await this.addTokens(
            purchase.userId,
            tokenAmountNum,
            `Purchase: ${purchase.id}`,
          );

          // Notify via WebSocket
          this.whatsAppGateway.sendAiTokenPurchaseCompleted(purchase.userId, {
            purchaseId: purchase.id,
            tokenAmount: tokenAmountNum,
            newBalance: (await this.getBalance(purchase.userId)).balance,
          });

          this.logger.log(
            `[AI-TOKEN] Purchase ${order_id} completed. Added ${purchase.tokenAmount} tokens`,
          );
        }
      } else {
        purchase.status = AiTokenPurchaseStatus.FAILED;
      }
    } else if (
      transaction_status === 'deny' ||
      transaction_status === 'cancel' ||
      transaction_status === 'failure'
    ) {
      purchase.status = AiTokenPurchaseStatus.FAILED;
    } else if (transaction_status === 'expire') {
      purchase.status = AiTokenPurchaseStatus.EXPIRED;
    }

    await this.purchaseRepository.save(purchase);
    this.logger.log(
      `[AI-TOKEN] Purchase ${order_id} status: ${previousStatus} -> ${purchase.status}`,
    );

    return { handled: true, purchase };
  }

  async getPurchaseByOrderId(orderId: string): Promise<AiTokenPurchase | null> {
    return this.purchaseRepository.findOne({
      where: { orderId },
      relations: ['package'],
    });
  }

  async failPurchase(purchaseId: string): Promise<AiTokenPurchase> {
    const purchase = await this.purchaseRepository.findOne({
      where: { id: purchaseId },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    purchase.status = AiTokenPurchaseStatus.FAILED;
    return this.purchaseRepository.save(purchase);
  }

  async getPurchaseHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: AiTokenPurchase[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [data, total] = await this.purchaseRepository.findAndCount({
      where: { userId },
      relations: ['package'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  // ==================== Usage History ====================

  async getUsageHistory(
    userId: string,
    page: number = 1,
    limit: number = 50,
    feature?: AiFeatureType,
  ): Promise<{
    data: AiTokenUsage[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where: any = { userId };
    if (feature) {
      where.feature = feature;
    }

    const [data, total] = await this.usageRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async getUsageStats(userId: string): Promise<{
    today: number;
    thisWeek: number;
    thisMonth: number;
    byFeature: Record<string, number>;
  }> {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Today's usage
    const todayResult = await this.usageRepository
      .createQueryBuilder('u')
      .select('SUM(u.tokensUsed)', 'total')
      .where('u.userId = :userId', { userId })
      .andWhere('u.createdAt >= :startOfDay', { startOfDay })
      .getRawOne();

    // This week's usage
    const weekResult = await this.usageRepository
      .createQueryBuilder('u')
      .select('SUM(u.tokensUsed)', 'total')
      .where('u.userId = :userId', { userId })
      .andWhere('u.createdAt >= :startOfWeek', { startOfWeek })
      .getRawOne();

    // This month's usage
    const monthResult = await this.usageRepository
      .createQueryBuilder('u')
      .select('SUM(u.tokensUsed)', 'total')
      .where('u.userId = :userId', { userId })
      .andWhere('u.createdAt >= :startOfMonth', { startOfMonth })
      .getRawOne();

    // Usage by feature (all time)
    const byFeatureResult = await this.usageRepository
      .createQueryBuilder('u')
      .select('u.feature', 'feature')
      .addSelect('SUM(u.tokensUsed)', 'total')
      .where('u.userId = :userId', { userId })
      .groupBy('u.feature')
      .getRawMany();

    const byFeature: Record<string, number> = {};
    for (const row of byFeatureResult) {
      byFeature[row.feature] = parseInt(row.total, 10);
    }

    return {
      today: parseInt(todayResult?.total || '0', 10),
      thisWeek: parseInt(weekResult?.total || '0', 10),
      thisMonth: parseInt(monthResult?.total || '0', 10),
      byFeature,
    };
  }
}
