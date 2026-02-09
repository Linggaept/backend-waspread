import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { ContactsService } from '../contacts/contacts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { SendMessageDto, SessionQueryDto, ConnectPairingDto } from './dto';

@ApiTags('WhatsApp')
@ApiBearerAuth('JWT-auth')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly contactsService: ContactsService,
  ) {}

  @Post('connect')
  @ApiOperation({ summary: 'Initialize/Connect WhatsApp session' })
  @ApiResponse({
    status: 201,
    description: 'Session initialized, returns QR code if needed',
  })
  async connect(@CurrentUser('id') userId: string) {
    try {
      return await this.whatsappService.initializeSession(userId);
    } catch (error) {
      throw new BadRequestException(`Failed to connect: ${error}`);
    }
  }

  @Post('connect-pairing')
  @ApiOperation({
    summary: 'Connect WhatsApp session via pairing code',
    description:
      'Initialize a WhatsApp session using a pairing code instead of QR scan. Returns an 8-digit code that the user enters in WhatsApp > Linked Devices > Link with Phone Number.',
  })
  @ApiResponse({
    status: 201,
    description: 'Pairing code generated',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'waiting_code' },
        code: { type: 'string', example: '12345678' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Failed to generate pairing code' })
  async connectWithPairing(
    @CurrentUser('id') userId: string,
    @Body() dto: ConnectPairingDto,
  ) {
    try {
      return await this.whatsappService.initializeSessionWithPairing(
        userId,
        dto.phoneNumber,
      );
    } catch (error) {
      throw new BadRequestException(
        `Failed to connect with pairing code: ${error}`,
      );
    }
  }

  @Post('reconnect')
  @ApiOperation({
    summary:
      'Force reconnect WhatsApp session (destroys existing and creates new)',
  })
  @ApiResponse({ status: 201, description: 'Session reinitialized' })
  async reconnect(@CurrentUser('id') userId: string) {
    try {
      // Force disconnect first
      await this.whatsappService.forceDisconnect(userId);
      // Wait a moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Then connect
      return await this.whatsappService.initializeSession(userId);
    } catch (error) {
      throw new BadRequestException(`Failed to reconnect: ${error}`);
    }
  }

  @Delete('disconnect')
  @ApiOperation({ summary: 'Disconnect session' })
  @ApiResponse({ status: 200, description: 'Session disconnected' })
  async disconnect(@CurrentUser('id') userId: string) {
    await this.whatsappService.disconnectSession(userId);
    return { message: 'Session disconnected successfully' };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get session status' })
  @ApiResponse({
    status: 200,
    description: 'Current session status and readiness',
  })
  async getStatus(@CurrentUser('id') userId: string) {
    const session = await this.whatsappService.getSessionStatus(userId);
    const isReady = await this.whatsappService.isSessionReady(userId);
    const stats = this.whatsappService.getSessionStats();

    return {
      session: session || { status: 'disconnected' },
      isReady,
      serverCapacity: stats,
    };
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a single message' })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Session not ready or send failed' })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException('WhatsApp session is not connected');
    }

    try {
      await this.whatsappService.sendMessage(
        userId,
        sendMessageDto.phoneNumber,
        sendMessageDto.message,
      );
      return { success: true, message: 'Message sent successfully' };
    } catch (error) {
      throw new BadRequestException(`Failed to send message: ${error}`);
    }
  }

  @Get('sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all sessions with pagination (Admin)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of all user sessions',
  })
  async getAllSessions(@Query() query: SessionQueryDto) {
    const { data, total } = await this.whatsappService.getAllSessions(query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 10,
      totalPages: Math.ceil(total / (query.limit || 10)),
    };
  }

  @Get('sessions/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get session server stats (Admin)' })
  @ApiResponse({
    status: 200,
    description: 'Server capacity and active sessions',
  })
  getSessionStats() {
    return this.whatsappService.getSessionStats();
  }

  // ==================== WhatsApp Contacts ====================

  @Get('contacts')
  @ApiOperation({
    summary: 'Get contacts from connected WhatsApp account',
    description:
      'Fetches all contacts from the connected WhatsApp account. Use onlyMyContacts=true to filter only contacts saved in phone.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of WhatsApp contacts',
    schema: {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              phoneNumber: { type: 'string', example: '628123456789' },
              name: { type: 'string', example: 'John Doe', nullable: true },
              pushname: { type: 'string', example: 'John', nullable: true },
              isMyContact: { type: 'boolean', example: true },
              isWAContact: { type: 'boolean', example: true },
            },
          },
        },
        total: { type: 'number', example: 150 },
        totalAll: {
          type: 'number',
          example: 200,
          description: 'Only present when onlyMyContacts=true',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Session not connected' })
  @ApiQuery({
    name: 'onlyMyContacts',
    required: false,
    type: Boolean,
    description: 'Only return contacts saved in phone',
  })
  async getWhatsAppContacts(
    @CurrentUser('id') userId: string,
    @Query('onlyMyContacts') onlyMyContacts?: string,
  ) {
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException(
        'WhatsApp session is not connected. Please connect first.',
      );
    }

    try {
      const result = await this.whatsappService.getWhatsAppContacts(userId);

      // Filter jika onlyMyContacts = true
      if (onlyMyContacts === 'true') {
        const filtered = result.contacts.filter((c) => c.isMyContact);
        return {
          contacts: filtered,
          total: filtered.length,
          totalAll: result.total,
        };
      }

      return result;
    } catch (error) {
      throw new BadRequestException(`Failed to get contacts: ${error}`);
    }
  }

  @Post('contacts/sync')
  @ApiOperation({
    summary: 'Sync WhatsApp contacts to database',
    description:
      'Syncs contacts from both WhatsApp contact store AND chat conversations to the database. Gets pushName for all contacts.',
  })
  @ApiResponse({
    status: 201,
    description: 'Contacts synced successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Contacts synced successfully' },
        imported: {
          type: 'number',
          example: 45,
          description: 'New contacts imported',
        },
        updated: {
          type: 'number',
          example: 10,
          description: 'Existing contacts updated',
        },
        skipped: {
          type: 'number',
          example: 5,
          description: 'Contacts skipped (duplicates or invalid)',
        },
        total: {
          type: 'number',
          example: 60,
          description: 'Total contacts processed',
        },
        fromWaContacts: {
          type: 'number',
          example: 50,
          description: 'Contacts from WhatsApp contact store',
        },
        fromChats: {
          type: 'number',
          example: 10,
          description: 'Additional contacts from chat history',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Session not connected or sync failed',
  })
  @ApiQuery({
    name: 'updateExisting',
    required: false,
    type: Boolean,
    description: 'Update existing contacts with WA info (default: true)',
  })
  async syncWhatsAppContacts(
    @CurrentUser('id') userId: string,
    @Query('updateExisting') updateExisting?: string,
  ) {
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException(
        'WhatsApp session is not connected. Please connect first.',
      );
    }

    try {
      // Sync all contacts (WA contact store + chat conversations)
      const result = await this.contactsService.syncAllContacts(userId, {
        updateExisting: updateExisting !== 'false',
      });

      return {
        message: 'Contacts synced successfully',
        ...result,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to sync contacts: ${error}`);
    }
  }

  @Post('contacts/check')
  @ApiOperation({
    summary: 'Check if phone numbers are registered on WhatsApp',
    description:
      'Checks whether the given phone numbers are registered on WhatsApp. Maximum 100 numbers per request.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration status for each number',
    schema: {
      type: 'object',
      properties: {
        registered: {
          type: 'array',
          items: { type: 'string' },
          example: ['628123456789'],
          description: 'Phone numbers that are registered on WhatsApp',
        },
        notRegistered: {
          type: 'array',
          items: { type: 'string' },
          example: ['628555666777'],
          description: 'Phone numbers that are NOT registered on WhatsApp',
        },
        totalChecked: { type: 'number', example: 2 },
        registeredCount: { type: 'number', example: 1 },
        notRegisteredCount: { type: 'number', example: 1 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Session not connected or invalid input',
  })
  async checkNumbersRegistered(
    @CurrentUser('id') userId: string,
    @Body() body: { phoneNumbers: string[] },
  ) {
    const isReady = await this.whatsappService.isSessionReady(userId);
    if (!isReady) {
      throw new BadRequestException(
        'WhatsApp session is not connected. Please connect first.',
      );
    }

    if (!body.phoneNumbers || body.phoneNumbers.length === 0) {
      throw new BadRequestException('phoneNumbers array is required');
    }

    if (body.phoneNumbers.length > 100) {
      throw new BadRequestException('Maximum 100 numbers per request');
    }

    try {
      const result = await this.whatsappService.checkNumbersRegistered(
        userId,
        body.phoneNumbers,
      );
      return {
        ...result,
        totalChecked: body.phoneNumbers.length,
        registeredCount: result.registered.length,
        notRegisteredCount: result.notRegistered.length,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to check numbers: ${error}`);
    }
  }
}
