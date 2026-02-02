import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { AuditAction } from '../../database/entities/audit-log.entity';

@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all audit logs with pagination (Admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of audit logs' })
  async findAll(@Query() query: AuditLogQueryDto) {
    const { data, total } = await this.auditService.findAll(query);
    return {
      data,
      total,
      page: query.page || 1,
      limit: query.limit || 20,
      totalPages: Math.ceil(total / (query.limit || 20)),
    };
  }

  @Get('logs/recent')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get recent audit logs (Admin only)' })
  @ApiResponse({ status: 200, description: 'List of recent audit logs' })
  async findRecent() {
    return this.auditService.findRecent(100);
  }

  @Get('actions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get list of available audit actions' })
  @ApiResponse({ status: 200, description: 'List of audit action types' })
  getActions() {
    return Object.values(AuditAction);
  }
}

