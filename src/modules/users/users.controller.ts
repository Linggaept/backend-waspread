import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    return this.usersService.excludePassword(user);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async findAll() {
    const users = await this.usersService.findAll();
    return users.map((user) => this.usersService.excludePassword(user));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findOne(id);
    return this.usersService.excludePassword(user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user = await this.usersService.update(id, updateUserDto);
    return this.usersService.excludePassword(user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.remove(id);
    return { message: 'User deleted successfully' };
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.activate(id);
    return this.usersService.excludePassword(user);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.deactivate(id);
    return this.usersService.excludePassword(user);
  }

  @Patch(':id/suspend')
  @Roles(UserRole.ADMIN)
  async suspend(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.suspend(id);
    return this.usersService.excludePassword(user);
  }
}
