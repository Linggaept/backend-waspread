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
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  KnowledgeQueryDto,
  UpdateAiSettingsDto,
  SuggestRequestDto,
} from './dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;

  constructor(
    @InjectRepository(AiKnowledgeBase)
    private readonly knowledgeRepository: Repository<AiKnowledgeBase>,
    @InjectRepository(AiSettings)
    private readonly settingsRepository: Repository<AiSettings>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    private readonly configService: ConfigService,
  ) {
    this.initializeGemini();
  }

  private initializeGemini() {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const modelName = this.configService.get<string>('gemini.model') || 'gemini-2.0-flash';

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: modelName });
      this.logger.log(`Gemini AI initialized with model: ${modelName}`);
    } else {
      this.logger.warn('Gemini API key not configured');
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
  ): Promise<{ data: AiKnowledgeBase[]; total: number; page: number; limit: number }> {
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
  ): Promise<{ imported: number; failed: number }> {
    let imported = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        await this.createKnowledge(userId, entry);
        imported++;
      } catch (error) {
        this.logger.error(`Failed to import: ${error}`);
        failed++;
      }
    }

    return { imported, failed };
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
        headers[colNumber] = String(cell.value || '').toLowerCase().trim();
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
          const content = String(row.getCell(contentCol + 1).value || '').trim();

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
            if (Object.values(KnowledgeCategory).includes(catValue as KnowledgeCategory)) {
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

  async generateSuggestions(
    userId: string,
    dto: SuggestRequestDto,
  ): Promise<{
    suggestions: string[];
    context: { knowledgeUsed: string[]; chatHistoryUsed: number };
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

    // 2. Get last 10 chat messages for context
    const chatHistory = await this.getChatHistory(userId, dto.phoneNumber, 5);

    // 3. Build prompt
    const prompt = this.buildPrompt(
      settings,
      relevantKnowledge,
      chatHistory,
      dto.message,
    );

    // 4. Call Gemini
    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      // Parse JSON response
      const suggestions = this.parseSuggestions(response);

      return {
        suggestions,
        context: {
          knowledgeUsed: relevantKnowledge.map((k) => k.title),
          chatHistoryUsed: chatHistory.length,
        },
      };
    } catch (error) {
      this.logger.error(`Gemini API error: ${error}`);
      throw new BadRequestException('Failed to generate suggestions');
    }
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

  private buildPrompt(
    settings: AiSettings,
    knowledge: AiKnowledgeBase[],
    chatHistory: ChatMessage[],
    incomingMessage: string,
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
        ? knowledge
            .map((k) => `- ${k.title}: ${k.content}`)
            .join('\n')
        : 'Tidak ada data referensi khusus.';

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

    return `${businessInfo}${businessDesc}

PANDUAN MENJAWAB:
- Gaya bahasa: ${toneGuide[settings.replyTone]}
- Singkat, jelas, dan membantu
- Fokus ke closing/konversi jika relevan
- Maksimal 150 karakter per opsi

DATA REFERENSI:
${knowledgeText}

RIWAYAT CHAT TERAKHIR:
${historyText}

PESAN PELANGGAN:
"${incomingMessage}"

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
