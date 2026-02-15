import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import {
  AiKnowledgeBase,
  KnowledgeCategory,
} from '../../database/entities/ai-knowledge-base.entity';
import {
  AiSettings,
  ReplyTone,
} from '../../database/entities/ai-settings.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { Product } from '../../database/entities/product.entity';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  KnowledgeQueryDto,
  UpdateAiSettingsDto,
  SuggestRequestDto,
} from './dto';
import { AiTokenPricingService } from './services/ai-token-pricing.service';

import { GoogleAIFileManager } from '@google/generative-ai/server';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private fileManager: GoogleAIFileManager | null = null;
  private model: any = null;

  constructor(
    @InjectRepository(AiKnowledgeBase)
    private readonly knowledgeRepository: Repository<AiKnowledgeBase>,
    @InjectRepository(AiSettings)
    private readonly settingsRepository: Repository<AiSettings>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly configService: ConfigService,
    private readonly pricingService: AiTokenPricingService,
  ) {
    this.initializeGemini();
  }

  private initializeGemini() {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const modelName =
      this.configService.get<string>('gemini.model') || 'gemini-2.0-flash';

    this.logger.debug(`[GEMINI] Initializing with model: ${modelName}`);
    this.logger.debug(
      `[GEMINI] API Key present: ${!!apiKey}, length: ${apiKey?.length || 0}`,
    );

    if (apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.fileManager = new GoogleAIFileManager(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: modelName });
        this.logger.log(
          `[GEMINI] AI initialized successfully with model: ${modelName}`,
        );
      } catch (err) {
        this.logger.error(`[GEMINI] Failed to initialize: ${err}`);
      }
    } else {
      this.logger.warn(
        '[GEMINI] API key not configured - AI features disabled',
      );
    }
  }

  /**
   * Upload file to Gemini File API
   */
  async uploadFileToGemini(
    filePath: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.fileManager) {
      throw new BadRequestException('Gemini File Manager not configured');
    }

    try {
      const uploadResponse = await this.fileManager.uploadFile(filePath, {
        mimeType,
        displayName: path.basename(filePath),
      });

      this.logger.log(`File uploaded to Gemini: ${uploadResponse.file.uri}`);
      return uploadResponse.file.uri;
    } catch (error) {
      this.logger.error(`Failed to upload file to Gemini: ${error}`);
      throw new BadRequestException('Failed to upload file to AI service');
    }
  }

  /**
   * Extract knowledge from file using multimodal AI
   */
  async generateKnowledgeFromMedia(
    fileUri: string,
    mimeType: string,
  ): Promise<CreateKnowledgeDto[]> {
    if (!this.genAI) {
      throw new BadRequestException('AI service not configured');
    }

    // Use Flash model for speed and multimodal capabilities
    const model = this.genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
      Analyze this document and extract ALL useful knowledge for a customer service knowledge base.
      DO NOT LIMIT the output. Extract as many items as found in the document.
      
      Focus on:
      1. Business profile (name, address, hours)
      2. Products/Services (name, price, description) - Extract ALL products found.
      3. Policies (return, shipping, warranty)
      4. FAQ (common questions and answers)

      Return ONLY a JSON array with this schema:
      [
        {
          "category": "product | faq | policy | custom",
          "title": "Short descriptive title",
          "content": "Detailed content (can use markdown)",
          "keywords": ["tag1", "tag2"]
        }
      ]
    `;

    try {
      // Wait for file to be active before generating content
      await this.waitForFileActive(fileUri);

      const result = await model.generateContent([
        {
          fileData: {
            mimeType,
            fileUri,
          },
        },
        { text: prompt },
      ]);

      const responseText = result.response.text();
      return JSON.parse(responseText) as CreateKnowledgeDto[];
    } catch (error) {
      this.logger.error(`Gemini extraction failed: ${error}`);
      throw new BadRequestException('Failed to extract knowledge from file');
    }
  }

  /**
   * Convert Excel to CSV for AI processing
   */
  async convertExcelToCsv(filePath: string): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.getWorksheet(1);
    const csvPath = filePath.replace(/\.xlsx?$/, '.csv');

    if (!sheet) {
      throw new BadRequestException('Excel file is empty');
    }

    await workbook.csv.writeFile(csvPath);
    return csvPath;
  }

  private async waitForFileActive(fileUri: string): Promise<void> {
    if (!this.fileManager) return;

    const name = fileUri.split('/').pop();
    let state = 'PROCESSING';

    // Poll for file status
    for (let i = 0; i < 10; i++) {
      try {
        const file = await this.fileManager.getFile(name!);
        state = file.state;
        if (state === 'ACTIVE') {
          return;
        }
        if (state === 'FAILED') {
          throw new Error('File processing failed in Gemini');
        }
        // Wait 2s
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e) {
        this.logger.warn(`Error checking file state: ${e}`);
      }
    }
  }

  // ==================== KNOWLEDGE BASE ====================

  async createKnowledge(
    userId: string,
    dto: CreateKnowledgeDto,
  ): Promise<AiKnowledgeBase> {
    const knowledge = this.knowledgeRepository.create({
      userId,
      ...dto,
    });
    return this.knowledgeRepository.save(knowledge);
  }

  async findAllKnowledge(
    userId: string,
    query: KnowledgeQueryDto,
  ): Promise<{
    data: AiKnowledgeBase[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 20, category, search, isActive } = query;

    const qb = this.knowledgeRepository.createQueryBuilder('kb');
    qb.where('kb.userId = :userId', { userId });

    if (category) {
      qb.andWhere('kb.category = :category', { category });
    }

    if (search) {
      qb.andWhere(
        '(kb.title ILIKE :search OR kb.content ILIKE :search OR :searchTerm = ANY(kb.keywords))',
        { search: `%${search}%`, searchTerm: search.toLowerCase() },
      );
    }

    if (isActive !== undefined) {
      qb.andWhere('kb.isActive = :isActive', { isActive });
    }

    qb.orderBy('kb.updatedAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async findOneKnowledge(userId: string, id: string): Promise<AiKnowledgeBase> {
    const knowledge = await this.knowledgeRepository.findOne({
      where: { id, userId },
    });

    if (!knowledge) {
      throw new NotFoundException('Knowledge entry not found');
    }

    return knowledge;
  }

  async updateKnowledge(
    userId: string,
    id: string,
    dto: UpdateKnowledgeDto,
  ): Promise<AiKnowledgeBase> {
    const knowledge = await this.findOneKnowledge(userId, id);
    Object.assign(knowledge, dto);
    return this.knowledgeRepository.save(knowledge);
  }

  async deleteKnowledge(userId: string, id: string): Promise<void> {
    const knowledge = await this.findOneKnowledge(userId, id);
    await this.knowledgeRepository.remove(knowledge);
  }

  async bulkDeleteKnowledge(
    userId: string,
    ids: string[],
  ): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    // Delete only entries that belong to the user
    const result = await this.knowledgeRepository
      .createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('id IN (:...ids)', { ids })
      .execute();

    deleted = result.affected || 0;
    failed = ids.length - deleted;

    this.logger.log(
      `Bulk delete for user ${userId}: ${deleted} deleted, ${failed} not found/failed`,
    );

    return { deleted, failed };
  }

  async bulkImportKnowledge(
    userId: string,
    entries: CreateKnowledgeDto[],
  ): Promise<{ imported: number; failed: number; data: AiKnowledgeBase[] }> {
    let imported = 0;
    let failed = 0;
    const data: AiKnowledgeBase[] = [];

    for (const entry of entries) {
      try {
        const result = await this.createKnowledge(userId, entry);
        data.push(result);
        imported++;
      } catch (error) {
        this.logger.error(`Failed to import: ${error}`);
        failed++;
      }
    }

    return { imported, failed, data };
  }

  async importKnowledgeFromFile(
    userId: string,
    filePath: string,
  ): Promise<{ imported: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    let failed = 0;

    try {
      const workbook = new ExcelJS.Workbook();
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.csv') {
        await workbook.csv.readFile(filePath);
      } else {
        await workbook.xlsx.readFile(filePath);
      }

      const sheet = workbook.getWorksheet(1);
      if (!sheet) {
        throw new BadRequestException('Empty file or invalid format');
      }

      // Get headers from first row
      const headers: string[] = [];
      const firstRow = sheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '')
          .toLowerCase()
          .trim();
      });

      // Find column indices
      const categoryCol = headers.findIndex((h) =>
        ['category', 'kategori', 'type'].includes(h),
      );
      const titleCol = headers.findIndex((h) =>
        ['title', 'judul', 'nama', 'name'].includes(h),
      );
      const contentCol = headers.findIndex((h) =>
        ['content', 'konten', 'isi', 'description', 'deskripsi'].includes(h),
      );
      const keywordsCol = headers.findIndex((h) =>
        ['keywords', 'keyword', 'kata kunci', 'tags'].includes(h),
      );

      if (titleCol === -1 || contentCol === -1) {
        throw new BadRequestException(
          'File must have "title" and "content" columns',
        );
      }

      // Collect entries from all rows
      const entriesToSave: AiKnowledgeBase[] = [];

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        try {
          const title = String(row.getCell(titleCol + 1).value || '').trim();
          const content = String(
            row.getCell(contentCol + 1).value || '',
          ).trim();

          if (!title || !content) {
            errors.push(`Row ${rowNumber}: Missing title or content`);
            failed++;
            return;
          }

          // Parse category
          let category = KnowledgeCategory.CUSTOM;
          if (categoryCol !== -1) {
            const catValue = String(row.getCell(categoryCol + 1).value || '')
              .toLowerCase()
              .trim();
            if (
              Object.values(KnowledgeCategory).includes(
                catValue as KnowledgeCategory,
              )
            ) {
              category = catValue as KnowledgeCategory;
            }
          }

          // Parse keywords
          let keywords: string[] = [];
          if (keywordsCol !== -1) {
            const kwValue = String(row.getCell(keywordsCol + 1).value || '');
            keywords = kwValue
              .split(/[,;]/)
              .map((k) => k.trim().toLowerCase())
              .filter((k) => k.length > 0);
          }

          // Create entity
          const knowledge = this.knowledgeRepository.create({
            userId,
            category,
            title,
            content,
            keywords: keywords.length > 0 ? keywords : undefined,
            isActive: true,
          });

          entriesToSave.push(knowledge);
        } catch (error) {
          errors.push(`Row ${rowNumber}: ${error}`);
          failed++;
        }
      });

      // Batch save all entries
      if (entriesToSave.length > 0) {
        await this.knowledgeRepository.save(entriesToSave);
        imported = entriesToSave.length;
      }

      // Cleanup temp file
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        this.logger.warn(`Failed to cleanup temp file: ${filePath}`);
      }

      this.logger.log(
        `Knowledge import for user ${userId}: ${imported} imported, ${failed} failed`,
      );

      return { imported, failed, errors };
    } catch (error) {
      // Cleanup on error
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}

      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to parse file: ${error}`);
    }
  }

  // ==================== SETTINGS ====================

  async getSettings(userId: string): Promise<AiSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      // Create default settings
      settings = this.settingsRepository.create({
        userId,
        isEnabled: true,
        replyTone: ReplyTone.FRIENDLY,
      });
      await this.settingsRepository.save(settings);
    }

    return settings;
  }

  async updateSettings(
    userId: string,
    dto: UpdateAiSettingsDto,
  ): Promise<AiSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { userId },
    });

    if (!settings) {
      settings = this.settingsRepository.create({
        userId,
        ...dto,
      });
    } else {
      Object.assign(settings, dto);
    }

    return this.settingsRepository.save(settings);
  }

  // ==================== SUGGEST (Core Feature) ====================

  /**
   * Calculate platform tokens from Gemini token usage (uses dynamic pricing from DB)
   */
  async calculatePlatformTokens(
    geminiTokens: number,
    featureKey?: string,
  ): Promise<number> {
    return this.pricingService.calculatePlatformTokens(
      geminiTokens,
      featureKey,
    );
  }

  async generateSuggestions(
    userId: string,
    dto: SuggestRequestDto & { imageData?: { mimetype: string; data: string } },
  ): Promise<{
    suggestions: string[];
    context: {
      knowledgeUsed: string[];
      productsUsed: string[];
      chatHistoryUsed: number;
      hasImage: boolean;
    };
    tokenUsage: { geminiTokens: number; platformTokens: number };
    matchedProducts?: { id: string; name: string; imageUrl: string | null }[];
  }> {
    if (!this.model) {
      throw new BadRequestException('AI service not configured');
    }

    const settings = await this.getSettings(userId);

    if (!settings.isEnabled) {
      throw new BadRequestException('AI suggestions are disabled');
    }

    // 1. Get relevant knowledge based on message keywords
    const relevantKnowledge = await this.searchRelevantKnowledge(
      userId,
      dto.message,
    );

    // 2. Get relevant products based on message keywords
    const relevantProducts = await this.searchRelevantProducts(
      userId,
      dto.message,
    );

    // 3. Get last 5 chat messages for context
    const chatHistory = await this.getChatHistory(userId, dto.phoneNumber, 5);

    // 4. Build prompt
    const prompt = this.buildPrompt(
      settings,
      relevantKnowledge,
      relevantProducts,
      chatHistory,
      dto.message,
      !!dto.imageData, // Flag that image is present
    );

    // 4. Call Gemini (with or without image)
    this.logger.debug(
      `[GEMINI] Generating suggestions for message: "${dto.message?.substring(0, 50)}..."`,
    );
    this.logger.debug(`[GEMINI] Model initialized: ${!!this.model}`);

    try {
      let result;

      if (dto.imageData && this.isImageMimetype(dto.imageData.mimetype)) {
        // Multimodal: text + image
        this.logger.debug(
          `[GEMINI] Generating with image (${dto.imageData.mimetype}, ${Math.round((dto.imageData.data?.length || 0) / 1024)}KB)`,
        );

        result = await this.model.generateContent([
          prompt,
          {
            inlineData: {
              mimeType: dto.imageData.mimetype,
              data: dto.imageData.data,
            },
          },
        ]);
      } else {
        // Text only
        this.logger.debug(`[GEMINI] Generating text-only response`);
        result = await this.model.generateContent(prompt);
      }

      const response = result.response.text();
      this.logger.debug(
        `[GEMINI] Raw response: ${response?.substring(0, 200)}...`,
      );

      // Get token usage from Gemini response
      const usageMetadata = result.response.usageMetadata;
      const geminiTokens = usageMetadata?.totalTokenCount || 0;
      const platformTokens = await this.calculatePlatformTokens(
        geminiTokens,
        'suggest',
      );

      this.logger.debug(
        `[GEMINI] Token usage: ${geminiTokens} Gemini tokens = ${platformTokens} platform tokens`,
      );

      // Parse JSON response
      const suggestions = this.parseSuggestions(response);
      this.logger.debug(`[GEMINI] Parsed ${suggestions.length} suggestions`);

      return {
        suggestions,
        context: {
          knowledgeUsed: relevantKnowledge.map((k) => k.title),
          productsUsed: relevantProducts.map((p) => p.name),
          chatHistoryUsed: chatHistory.length,
          hasImage: !!dto.imageData,
        },
        tokenUsage: {
          geminiTokens,
          platformTokens,
        },
        matchedProducts: relevantProducts.map((p) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.imageUrl || null,
        })),
      };
    } catch (error: any) {
      this.logger.error(`[GEMINI] API error: ${error?.message || error}`);
      this.logger.error(`[GEMINI] Error stack: ${error?.stack}`);
      throw new BadRequestException(
        `Failed to generate suggestions: ${error?.message}`,
      );
    }
  }

  private isImageMimetype(mimetype: string): boolean {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
      mimetype,
    );
  }

  private async searchRelevantKnowledge(
    userId: string,
    message: string,
  ): Promise<AiKnowledgeBase[]> {
    // Extract keywords from message
    const words = message
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) {
      // Return some general knowledge
      return this.knowledgeRepository.find({
        where: { userId, isActive: true },
        take: 3,
        order: { updatedAt: 'DESC' },
      });
    }

    // Search by keywords and content
    const qb = this.knowledgeRepository.createQueryBuilder('kb');
    qb.where('kb.userId = :userId', { userId });
    qb.andWhere('kb.isActive = true');

    // Build OR conditions for each word
    const conditions: string[] = [];
    const params: Record<string, any> = { userId };

    words.forEach((word, i) => {
      conditions.push(`kb.title ILIKE :word${i}`);
      conditions.push(`kb.content ILIKE :word${i}`);
      conditions.push(`:keyword${i} = ANY(kb.keywords)`);
      params[`word${i}`] = `%${word}%`;
      params[`keyword${i}`] = word;
    });

    qb.andWhere(`(${conditions.join(' OR ')})`, params);
    qb.take(5);

    const results = await qb.getMany();

    // If no results, return general knowledge
    if (results.length === 0) {
      return this.knowledgeRepository.find({
        where: { userId, isActive: true },
        take: 3,
        order: { updatedAt: 'DESC' },
      });
    }

    return results;
  }

  private async getChatHistory(
    userId: string,
    phoneNumber: string,
    limit: number,
  ): Promise<ChatMessage[]> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    return this.chatMessageRepository.find({
      where: { userId, phoneNumber: normalized },
      order: { timestamp: 'DESC' },
      take: limit,
      select: ['direction', 'body', 'timestamp'],
    });
  }

  private async searchRelevantProducts(
    userId: string,
    message: string,
  ): Promise<Product[]> {
    // Extract keywords from message
    const words = message
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Common product-related keywords to boost relevance
    const productKeywords = [
      'produk',
      'harga',
      'beli',
      'order',
      'pesan',
      'jual',
      'berapa',
      'stock',
      'stok',
      'ready',
      'ada',
      'mau',
      'cari',
      'punya',
      'jasa',
      'layanan',
    ];
    const hasProductIntent = words.some((w) => productKeywords.includes(w));

    this.logger.debug(
      `[PRODUCTS] Searching for user ${userId}, words: ${words.join(', ')}, hasProductIntent: ${hasProductIntent}`,
    );

    // If message seems product-related, search products
    if (hasProductIntent || words.length === 0) {
      const qb = this.productRepository.createQueryBuilder('p');
      qb.where('p.userId = :userId', { userId });
      qb.andWhere('p.isHidden = false');

      if (words.length > 0) {
        // Build OR conditions for product name/description matching
        const conditions: string[] = [];
        const params: Record<string, any> = { userId };

        words.forEach((word, i) => {
          conditions.push(`p.name ILIKE :word${i}`);
          conditions.push(`p.description ILIKE :word${i}`);
          params[`word${i}`] = `%${word}%`;
        });

        qb.andWhere(`(${conditions.join(' OR ')})`, params);
      }

      qb.orderBy('p.createdAt', 'DESC');
      qb.take(5);

      const products = await qb.getMany();
      this.logger.debug(
        `[PRODUCTS] Found ${products.length} products: ${products.map((p) => p.name).join(', ')}`,
      );
      return products;
    }

    // Fallback: always return some products if user has any (for general queries)
    const fallbackProducts = await this.productRepository.find({
      where: { userId, isHidden: false },
      take: 3,
      order: { createdAt: 'DESC' },
    });
    this.logger.debug(
      `[PRODUCTS] Fallback: ${fallbackProducts.length} products`,
    );
    return fallbackProducts;
  }

  private buildPrompt(
    settings: AiSettings,
    knowledge: AiKnowledgeBase[],
    products: Product[],
    chatHistory: ChatMessage[],
    incomingMessage: string,
    hasImage: boolean = false,
  ): string {
    const businessInfo = settings.businessName
      ? `Kamu adalah customer service untuk "${settings.businessName}".`
      : 'Kamu adalah customer service yang helpful.';

    const businessDesc = settings.businessDescription
      ? `\n${settings.businessDescription}`
      : '';

    const toneGuide = {
      [ReplyTone.FORMAL]: 'formal dan profesional',
      [ReplyTone.CASUAL]: 'santai tapi tetap sopan',
      [ReplyTone.FRIENDLY]: 'ramah dan bersahabat, boleh pakai emoji',
    };

    const knowledgeText =
      knowledge.length > 0
        ? knowledge.map((k) => `- ${k.title}: ${k.content}`).join('\n')
        : 'Tidak ada data referensi khusus.';

    // Format products with price
    const formatPrice = (price: number, currency: string) => {
      if (currency === 'IDR') {
        return `Rp ${Number(price).toLocaleString('id-ID')}`;
      }
      return `${currency} ${Number(price).toLocaleString()}`;
    };

    const productsText =
      products.length > 0
        ? products
            .map((p) => {
              const priceStr = formatPrice(p.price, p.currency);
              const desc = p.description ? ` - ${p.description}` : '';
              return `- ${p.name}: ${priceStr}${desc}`;
            })
            .join('\n')
        : '';

    const historyText =
      chatHistory.length > 0
        ? chatHistory
            .reverse()
            .map(
              (m) =>
                `${m.direction === 'incoming' ? 'Pelanggan' : 'CS'}: ${m.body || '[media]'}`,
            )
            .join('\n')
        : 'Belum ada riwayat chat.';

    // Add image context if present
    const imageContext = hasImage
      ? `
CATATAN: Pelanggan juga mengirim GAMBAR bersama pesan ini.
- Analisis gambar tersebut
- Jika gambar berisi produk/screenshot, identifikasi dan berikan info relevan
- Jika gambar bukti transfer, konfirmasi penerimaan
- Jika gambar error/masalah, berikan solusi
`
      : '';

    const messageContext = incomingMessage
      ? `PESAN PELANGGAN:\n"${incomingMessage}"`
      : hasImage
        ? 'PESAN PELANGGAN:\n[Pelanggan mengirim gambar tanpa teks]'
        : 'PESAN PELANGGAN:\n[Tidak ada pesan]';

    // Build data sections
    let dataSection = '';
    let productInstruction = '';

    if (productsText) {
      dataSection += `\n📦 DAFTAR PRODUK/JASA TERSEDIA:\n${productsText}\n`;
      productInstruction = `
⚠️ WAJIB: Jika pelanggan tanya tentang produk/jasa/harga, HARUS sebutkan NAMA PRODUK dan HARGA dari daftar di atas!
Contoh: "Untuk Joki Website harganya Rp 200.000 kak" atau "Ada Joki Website Rp 200rb kak, mau order?"`;
    }

    if (knowledge.length > 0) {
      dataSection += `\n📋 INFORMASI TAMBAHAN:\n${knowledgeText}`;
    }

    if (!productsText && knowledge.length === 0) {
      dataSection = '\nTidak ada data referensi khusus.';
    }

    return `${businessInfo}${businessDesc}

PANDUAN MENJAWAB:
- Gaya bahasa: ${toneGuide[settings.replyTone]}
- Singkat, jelas, dan membantu
- Fokus ke closing/konversi
- Maksimal 150 karakter per opsi
${productInstruction}
${imageContext}
${dataSection}

RIWAYAT CHAT TERAKHIR:
${historyText}

${messageContext}

Berikan 3 opsi balasan berbeda yang natural.
PENTING: Response HARUS dalam format JSON array saja, tanpa markdown atau penjelasan lain.
Contoh format yang benar: ["opsi 1", "opsi 2", "opsi 3"]`;
  }

  private parseSuggestions(response: string): string[] {
    try {
      // Clean response - remove markdown code blocks if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 3).map((s) => String(s));
      }

      throw new Error('Invalid response format');
    } catch (error) {
      this.logger.error(`Failed to parse suggestions: ${response}`);
      // Return fallback suggestions
      return [
        'Terima kasih atas pertanyaannya. Bisa saya bantu dengan informasi lebih lanjut?',
        'Mohon maaf, bisa diperjelas pertanyaannya?',
        'Baik kak, ada yang bisa saya bantu?',
      ];
    }
  }

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    return cleaned;
  }
}
