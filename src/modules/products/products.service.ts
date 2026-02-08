import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(userId: string, dto: CreateProductDto): Promise<Product> {
    const product = this.productRepository.create({
      userId,
      ...dto,
    });
    return this.productRepository.save(product);
  }

  async findAll(
    userId: string,
    query: ProductQueryDto,
  ): Promise<{ data: Product[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20, search } = query;
    const qb = this.productRepository.createQueryBuilder('p');
    qb.where('p.userId = :userId', { userId });

    if (search) {
      qb.andWhere('(p.name ILIKE :search OR p.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    qb.orderBy('p.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findOne(userId: string, id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, userId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findOne(userId, id);
    Object.assign(product, dto);
    return this.productRepository.save(product);
  }

  async delete(userId: string, id: string): Promise<void> {
    const product = await this.findOne(userId, id);
    await this.productRepository.remove(product);
  }
}
