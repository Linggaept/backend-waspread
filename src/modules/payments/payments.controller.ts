import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, MidtransNotificationDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create payment / checkout' })
  @ApiResponse({ status: 201, description: 'Payment created, returns Snap token and redirect URL' })
  createPayment(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() createPaymentDto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(userId, userEmail, createPaymentDto);
  }

  @Post('notification')
  @ApiOperation({ summary: 'Midtrans webhook notification' })
  @ApiResponse({ status: 200, description: 'Notification processed' })
  handleNotification(@Req() req: Request) {
    // Bypass global validation pipe - Midtrans sends dynamic fields based on payment type
    const notification = req.body as MidtransNotificationDto;
    return this.paymentsService.handleNotification(notification);
  }

  @Get('my-payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user payment history' })
  @ApiResponse({ status: 200, description: 'List of user payments' })
  findMyPayments(@CurrentUser('id') userId: string) {
    return this.paymentsService.findByUser(userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all payments (Admin)' })
  @ApiResponse({ status: 200, description: 'List of all payments' })
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment details' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }
}
