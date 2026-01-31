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
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // User Dashboard
  @Get('dashboard')
  getDashboard(@CurrentUser('id') userId: string) {
    return this.reportsService.getDashboardStats(userId);
  }

  // User Blast Reports
  @Get('blasts')
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

  // Message Report for specific blast
  @Get('blasts/:id/messages')
  getMessageReport(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportsService.getMessageReport(userId, id);
  }

  // Export blast messages to CSV
  @Get('blasts/:id/export')
  @Header('Content-Type', 'text/csv')
  async exportBlast(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportBlastToCsv(userId, id);
    res.setHeader('Content-Disposition', `attachment; filename=blast-${id}.csv`);
    res.send(csv);
  }

  // Export all blasts to CSV
  @Get('export')
  @Header('Content-Type', 'text/csv')
  async exportAllBlasts(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportAllBlastsToCsv(userId);
    res.setHeader('Content-Disposition', 'attachment; filename=all-blasts.csv');
    res.send(csv);
  }

  // Admin: Dashboard
  @Get('admin/dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAdminDashboard() {
    return this.reportsService.getAdminDashboard();
  }

  // Admin: User Reports
  @Get('admin/users')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getUserReports() {
    return this.reportsService.getAdminUserReports();
  }

  // Admin: Revenue Report
  @Get('admin/revenue')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getRevenueReport(@Query() dateRange: DateRangeDto) {
    return this.reportsService.getRevenueReport(
      dateRange.startDate,
      dateRange.endDate,
    );
  }
}
