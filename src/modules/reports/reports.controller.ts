import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProduces,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import {
  DateRangeDto,
  DashboardStatsDto,
  BlastReportDto,
  MessageReportDto,
  AdminUserReportDto,
  RevenueReportDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Reports')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get user dashboard stats' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard stats',
    type: DashboardStatsDto,
  })
  getDashboard(@CurrentUser('id') userId: string) {
    return this.reportsService.getDashboardStats(userId);
  }

  @Get('blasts')
  @ApiOperation({ summary: 'Get blast reports with date filter' })
  @ApiResponse({
    status: 200,
    description: 'List of blast reports',
    type: [BlastReportDto],
  })
  getBlastReports(
    @CurrentUser('id') userId: string,
    @Query() dateRange: DateRangeDto,
  ) {
    return this.reportsService.getBlastReports(
      userId,
      dateRange.startDate,
      dateRange.endDate,
    );
  }

  @Get('blasts/:id/messages')
  @ApiOperation({ summary: 'Get message details for a blast' })
  @ApiResponse({
    status: 200,
    description: 'List of message details',
    type: [MessageReportDto],
  })
  getMessageReport(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportsService.getMessageReport(userId, id);
  }

  @Get('blasts/:id/export')
  @Header('Content-Type', 'text/csv')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export blast messages to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  async exportBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportBlastToCsv(userId, id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=blast-${id}.csv`,
    );
    res.send(csv);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export all blasts to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  async exportAllBlasts(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportAllBlastsToCsv(userId);
    res.setHeader('Content-Disposition', 'attachment; filename=all-blasts.csv');
    res.send(csv);
  }

  @Get('admin/dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get admin dashboard stats' })
  @ApiResponse({ status: 200, description: 'Admin dashboard stats' })
  getAdminDashboard() {
    return this.reportsService.getAdminDashboard();
  }

  @Get('admin/users')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user activity reports' })
  @ApiResponse({
    status: 200,
    description: 'User activity reports',
    type: [AdminUserReportDto],
  })
  getUserReports() {
    return this.reportsService.getAdminUserReports();
  }

  @Get('admin/revenue')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get revenue report' })
  @ApiResponse({
    status: 200,
    description: 'Revenue report',
    type: RevenueReportDto,
  })
  getRevenueReport(@Query() dateRange: DateRangeDto) {
    return this.reportsService.getRevenueReport(
      dateRange.startDate,
      dateRange.endDate,
    );
  }
}
