import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, MidtransNotificationDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Create payment / checkout
  @Post()
  @UseGuards(JwtAuthGuard)
  createPayment(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() createPaymentDto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(userId, userEmail, createPaymentDto);
  }

  // Midtrans webhook notification
  @Post('notification')
  handleNotification(@Body() notification: MidtransNotificationDto) {
    return this.paymentsService.handleNotification(notification);
  }

  // Get user's payment history
  @Get('my-payments')
  @UseGuards(JwtAuthGuard)
  findMyPayments(@CurrentUser('id') userId: string) {
    return this.paymentsService.findByUser(userId);
  }

  // Admin: get all payments
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.paymentsService.findAll();
  }

  // Get payment by ID
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }
}
