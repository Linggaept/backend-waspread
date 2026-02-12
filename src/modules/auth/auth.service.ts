import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { UsersService } from '../users/users.service';
import { PackagesService } from '../packages/packages.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  VerifyResetCodeDto,
  ResetPasswordDto,
} from './dto';
import { UserStatus } from '../../database/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { PasswordReset } from '../../database/entities/password-reset.entity';
import { MailService } from '../mail/mail.service';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  NotificationChannel,
} from '../../database/entities/notification.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly packagesService: PackagesService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Check if email exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Create user
    const user = await this.usersService.create({
      email: registerDto.email,
      password: registerDto.password,
      name: registerDto.name,
      phone: registerDto.phone,
    });

    // Generate token
    const token = this.generateToken(user.id, user.email, user.role);

    // Auto-assign Free Trial if available
    try {
      const freePackages = await this.packagesService.findAll();
      const freeTrial = freePackages.find((p) => p.price === 0 && p.isActive);

      if (freeTrial) {
        await this.subscriptionsService.activateSubscription(
          user.id,
          freeTrial.id,
          null,
        );
      }
    } catch (error) {
      this.logger.error('Failed to assign free trial', error);
    }

    // Audit log
    this.auditService.log({
      userId: user.id,
      action: AuditAction.REGISTER,
      metadata: { email: user.email },
    });

    // Send welcome notification
    this.notificationsService
      .notifyWelcome(user.id, user.email, user.name)
      .catch((err) => {
        this.logger.error('Failed to send welcome notification', err);
      });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check user status
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        'Your account is not active. Please contact support.',
      );
    }

    // Generate token
    const token = this.generateToken(user.id, user.email, user.role);

    // Audit log
    this.auditService.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      metadata: { email: user.email },
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    return this.usersService.excludePassword(user);
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);

    // Always return success even if user not found (security)
    if (!user) {
      return {
        message:
          'If your email is registered, you will receive a reset code shortly.',
      };
    }

    // Generate cryptographically secure 6 digit code
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 mins expiry

    // Save to DB
    await this.passwordResetRepository.save({
      userId: user.id,
      email: user.email,
      code,
      expiresAt,
    });

    // Send email
    await this.mailService.sendPasswordResetCode(user.email, code, user.name);

    return {
      message:
        'If your email is registered, you will receive a reset code shortly.',
    };
  }

  async verifyResetCode(verifyDto: VerifyResetCodeDto) {
    const { email, code } = verifyDto;

    const resetRequest = await this.passwordResetRepository.findOne({
      where: {
        email,
        code,
        isVerified: false,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (!resetRequest) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    // Generate reset token
    const resetToken = uuidv4();

    // Update request
    resetRequest.isVerified = true;
    resetRequest.resetToken = resetToken;
    await this.passwordResetRepository.save(resetRequest);

    return { resetToken };
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    const { resetToken, newPassword } = resetDto;

    const resetRequest = await this.passwordResetRepository.findOne({
      where: {
        resetToken,
        isVerified: true,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
      relations: ['user'],
    });

    if (!resetRequest) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password
    await this.usersService.updatePassword(resetRequest.userId, newPassword);

    // Mark as used
    resetRequest.isUsed = true;
    await this.passwordResetRepository.save(resetRequest);

    // Send password changed notification
    this.notificationsService
      .notify({
        userId: resetRequest.userId,
        type: NotificationType.PASSWORD_CHANGED,
        title: 'Password Berhasil Diubah',
        message:
          'Password akun Anda telah berhasil diubah. Jika Anda tidak melakukan ini, segera hubungi support.',
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        email: resetRequest.email,
      })
      .catch((err) => {
        this.logger.error('Failed to send password changed notification', err);
      });

    return {
      message:
        'Password reset successful. You can now login with your new password.',
    };
  }

  private generateToken(userId: string, email: string, role: string): string {
    const payload = {
      sub: userId,
      email,
      role,
    };
    return this.jwtService.sign(payload);
  }
}
