import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Template } from '../../database/entities/template.entity';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from './dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
  ) {}

  async create(
    userId: string,
    createTemplateDto: CreateTemplateDto,
    imageUrl?: string,
  ): Promise<Template> {
    // Auto-detect variables from message if not provided
    const variables = createTemplateDto.variables || this.extractVariables(createTemplateDto.message);

    const template = this.templateRepository.create({
      userId,
      name: createTemplateDto.name,
      message: createTemplateDto.message,
      imageUrl,
      category: createTemplateDto.category,
      variables,
    });

    const saved = await this.templateRepository.save(template);
    this.logger.log(`Template ${saved.id} created for user ${userId}`);
    return saved;
  }

  async findAll(
    userId: string,
    query: TemplateQueryDto,
  ): Promise<{ data: Template[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.templateRepository.createQueryBuilder('template');
    qb.where('template.userId = :userId', { userId });

    if (query.search) {
      qb.andWhere('template.name ILIKE :search', { search: `%${query.search}%` });
    }

    if (query.category) {
      qb.andWhere('template.category = :category', { category: query.category });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('template.isActive = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('template.updatedAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(userId: string, id: string): Promise<Template> {
    const template = await this.templateRepository.findOne({
      where: { id, userId },
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return template;
  }

  async update(
    userId: string,
    id: string,
    updateTemplateDto: UpdateTemplateDto,
    imageUrl?: string,
  ): Promise<Template> {
    const template = await this.findOne(userId, id);

    // Update fields
    if (updateTemplateDto.name !== undefined) {
      template.name = updateTemplateDto.name;
    }
    if (updateTemplateDto.message !== undefined) {
      template.message = updateTemplateDto.message;
      // Re-extract variables if message changed
      template.variables = updateTemplateDto.variables || this.extractVariables(updateTemplateDto.message);
    }
    if (updateTemplateDto.category !== undefined) {
      template.category = updateTemplateDto.category;
    }
    if (updateTemplateDto.isActive !== undefined) {
      template.isActive = updateTemplateDto.isActive;
    }
    if (imageUrl) {
      template.imageUrl = imageUrl;
    }

    return this.templateRepository.save(template);
  }

  async remove(userId: string, id: string): Promise<void> {
    const template = await this.findOne(userId, id);
    await this.templateRepository.remove(template);
    this.logger.log(`Template ${id} deleted for user ${userId}`);
  }

  async removeImage(userId: string, id: string): Promise<Template> {
    const template = await this.findOne(userId, id);
    template.imageUrl = undefined;
    return this.templateRepository.save(template);
  }

  async incrementUsage(userId: string, id: string): Promise<void> {
    await this.templateRepository.update(
      { id, userId },
      {
        usageCount: () => 'usageCount + 1',
        lastUsedAt: new Date(),
      },
    );
  }

  async getCategories(userId: string): Promise<string[]> {
    const result = await this.templateRepository
      .createQueryBuilder('template')
      .select('DISTINCT template.category', 'category')
      .where('template.userId = :userId', { userId })
      .andWhere('template.category IS NOT NULL')
      .getRawMany();

    return result.map((r) => r.category).filter(Boolean);
  }

  async getPopularTemplates(userId: string, limit = 5): Promise<Template[]> {
    return this.templateRepository.find({
      where: { userId, isActive: true },
      order: { usageCount: 'DESC' },
      take: limit,
    });
  }

  async renderMessage(
    message: string,
    variableValues?: Record<string, string>,
  ): Promise<string> {
    if (!variableValues) return message;

    let rendered = message;
    for (const [key, value] of Object.entries(variableValues)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      rendered = rendered.replace(regex, value);
    }
    return rendered;
  }

  async getTemplateForBlast(
    userId: string,
    templateId: string,
    variableValues?: Record<string, string>,
  ): Promise<{ message: string; imageUrl?: string }> {
    const template = await this.findOne(userId, templateId);

    // Increment usage
    await this.incrementUsage(userId, templateId);

    // Render message with variables
    const message = await this.renderMessage(template.message, variableValues);

    return {
      message,
      imageUrl: template.imageUrl,
    };
  }

  private extractVariables(message: string): string[] {
    const regex = /\{(\w+)\}/g;
    const variables: string[] = [];
    let match;

    while ((match = regex.exec(message)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    return variables;
  }
}
