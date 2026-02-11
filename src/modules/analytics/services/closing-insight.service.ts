import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ConversationFunnel,
  FunnelStage,
  AiInsight,
} from '../../../database/entities/conversation-funnel.entity';
import { ChatMessage } from '../../../database/entities/chat-message.entity';

@Injectable()
export class ClosingInsightService {
  private readonly logger = new Logger(ClosingInsightService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;

  constructor(
    @InjectRepository(ConversationFunnel)
    private readonly funnelRepository: Repository<ConversationFunnel>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    private readonly configService: ConfigService,
  ) {
    this.initializeGemini();
  }

  private initializeGemini() {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    const modelName =
      this.configService.get<string>('gemini.model') || 'gemini-2.0-flash';

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: modelName });
      this.logger.log(
        `Closing Insight AI initialized with model: ${modelName}`,
      );
    } else {
      this.logger.warn('Gemini API key not configured - AI insights disabled');
    }
  }

  /**
   * Auto-triggered when a conversation closes (won or lost)
   */
  async analyzeClosing(
    userId: string,
    phoneNumber: string,
  ): Promise<AiInsight | null> {
    if (!this.model) {
      this.logger.warn('AI not configured, skipping closing analysis');
      return null;
    }

    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Get funnel
    const funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!funnel) {
      this.logger.warn(`No funnel found for ${normalizedPhone}`);
      return null;
    }

    // Skip if already analyzed
    if (funnel.isAnalyzed && funnel.aiInsight) {
      this.logger.debug(`Funnel ${normalizedPhone} already analyzed`);
      return funnel.aiInsight;
    }

    // Only analyze closed conversations
    if (
      funnel.currentStage !== FunnelStage.CLOSED_WON &&
      funnel.currentStage !== FunnelStage.CLOSED_LOST
    ) {
      this.logger.debug(
        `Funnel ${normalizedPhone} not closed yet, skipping analysis`,
      );
      return null;
    }

    // Get chat history
    const chatHistory = await this.chatMessageRepository.find({
      where: { userId, phoneNumber: normalizedPhone },
      order: { timestamp: 'ASC' },
      take: 50, // Limit to last 50 messages
    });

    if (chatHistory.length < 2) {
      this.logger.debug(
        `Not enough chat history for ${normalizedPhone}, skipping analysis`,
      );
      return null;
    }

    // Build and call AI
    const prompt = this.buildAnalysisPrompt(funnel, chatHistory);

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      const insight = this.parseInsightResponse(response, funnel.currentStage);
      insight.analyzedAt = new Date();

      // Save to funnel
      funnel.aiInsight = insight;
      funnel.isAnalyzed = true;
      await this.funnelRepository.save(funnel);

      this.logger.log(
        `AI insight generated for ${normalizedPhone}: ${funnel.currentStage}`,
      );

      return insight;
    } catch (error) {
      this.logger.error(`AI analysis failed for ${normalizedPhone}: ${error}`);
      return null;
    }
  }

  /**
   * Force re-analyze a conversation
   */
  async reanalyze(userId: string, phoneNumber: string): Promise<AiInsight> {
    if (!this.model) {
      throw new BadRequestException('AI service not configured');
    }

    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    if (!funnel) {
      throw new BadRequestException('Conversation not found');
    }

    // Reset analyzed flag to force re-analysis
    funnel.isAnalyzed = false;
    funnel.aiInsight = null;
    await this.funnelRepository.save(funnel);

    const insight = await this.analyzeClosing(userId, phoneNumber);

    if (!insight) {
      throw new BadRequestException('Failed to generate insight');
    }

    return insight;
  }

  /**
   * Get insight for a conversation
   */
  async getInsight(
    userId: string,
    phoneNumber: string,
  ): Promise<AiInsight | null> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    const funnel = await this.funnelRepository.findOne({
      where: { userId, phoneNumber: normalizedPhone },
    });

    return funnel?.aiInsight || null;
  }

  /**
   * Generate aggregate patterns from all analyzed conversations
   */
  async getPatterns(
    userId: string,
    period: { startDate: Date; endDate: Date },
  ): Promise<{
    totalAnalyzed: number;
    closedWon: number;
    closedLost: number;
    topSuccessFactors: Array<{
      factor: string;
      frequency: number;
      percentage: number;
    }>;
    topFailureFactors: Array<{
      factor: string;
      frequency: number;
      percentage: number;
    }>;
    recommendations: string[];
    avgTimeToClose: string;
  }> {
    // Get all analyzed funnels in period
    const funnels = await this.funnelRepository
      .createQueryBuilder('funnel')
      .where('funnel.userId = :userId', { userId })
      .andWhere('funnel.isAnalyzed = true')
      .andWhere('funnel.closedAt >= :startDate', {
        startDate: period.startDate,
      })
      .andWhere('funnel.closedAt <= :endDate', { endDate: period.endDate })
      .getMany();

    const closedWon = funnels.filter(
      (f) => f.currentStage === FunnelStage.CLOSED_WON,
    );
    const closedLost = funnels.filter(
      (f) => f.currentStage === FunnelStage.CLOSED_LOST,
    );

    // Aggregate success factors
    const successFactorCounts: Record<string, number> = {};
    for (const funnel of closedWon) {
      if (funnel.aiInsight?.successFactors) {
        for (const sf of funnel.aiInsight.successFactors) {
          successFactorCounts[sf.factor] =
            (successFactorCounts[sf.factor] || 0) + 1;
        }
      }
    }

    // Aggregate failure factors
    const failureFactorCounts: Record<string, number> = {};
    for (const funnel of closedLost) {
      if (funnel.aiInsight?.failureFactors) {
        for (const ff of funnel.aiInsight.failureFactors) {
          failureFactorCounts[ff.factor] =
            (failureFactorCounts[ff.factor] || 0) + 1;
        }
      }
    }

    // Sort and format
    const topSuccessFactors = Object.entries(successFactorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor, frequency]) => ({
        factor,
        frequency,
        percentage:
          closedWon.length > 0
            ? Math.round((frequency / closedWon.length) * 100)
            : 0,
      }));

    const topFailureFactors = Object.entries(failureFactorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor, frequency]) => ({
        factor,
        frequency,
        percentage:
          closedLost.length > 0
            ? Math.round((frequency / closedLost.length) * 100)
            : 0,
      }));

    // Calculate average time to close
    let avgTimeMinutes = 0;
    let countWithTime = 0;
    for (const funnel of closedWon) {
      if (funnel.blastSentAt && funnel.closedAt) {
        const timeMs = funnel.closedAt.getTime() - funnel.blastSentAt.getTime();
        avgTimeMinutes += timeMs / (1000 * 60);
        countWithTime++;
      } else if (funnel.repliedAt && funnel.closedAt) {
        const timeMs = funnel.closedAt.getTime() - funnel.repliedAt.getTime();
        avgTimeMinutes += timeMs / (1000 * 60);
        countWithTime++;
      }
    }

    if (countWithTime > 0) {
      avgTimeMinutes = avgTimeMinutes / countWithTime;
    }

    const avgTimeToClose = this.formatDuration(avgTimeMinutes);

    // Generate recommendations based on patterns
    const recommendations: string[] = [];

    if (topSuccessFactors.length > 0) {
      const topFactor = topSuccessFactors[0];
      recommendations.push(
        `${topFactor.percentage}% closing berhasil karena ${topFactor.factor} - jadikan prioritas utama`,
      );
    }

    if (topFailureFactors.length > 0) {
      const topFail = topFailureFactors[0];
      recommendations.push(
        `${topFail.percentage}% gagal closing karena ${topFail.factor} - perlu diperbaiki`,
      );
    }

    if (avgTimeMinutes > 0) {
      if (avgTimeMinutes < 60) {
        recommendations.push(
          `Rata-rata closing ${avgTimeToClose} - response time sangat baik!`,
        );
      } else if (avgTimeMinutes < 1440) {
        recommendations.push(
          `Rata-rata closing ${avgTimeToClose} - coba tingkatkan kecepatan response`,
        );
      } else {
        recommendations.push(
          `Rata-rata closing ${avgTimeToClose} - terlalu lama, perlu follow-up lebih aktif`,
        );
      }
    }

    return {
      totalAnalyzed: funnels.length,
      closedWon: closedWon.length,
      closedLost: closedLost.length,
      topSuccessFactors,
      topFailureFactors,
      recommendations,
      avgTimeToClose,
    };
  }

  private buildAnalysisPrompt(
    funnel: ConversationFunnel,
    chatHistory: ChatMessage[],
  ): string {
    const isWon = funnel.currentStage === FunnelStage.CLOSED_WON;
    const outcomeText = isWon ? 'BERHASIL CLOSING' : 'GAGAL CLOSING';

    // Format chat history
    const historyText = chatHistory
      .map((m) => {
        const sender = m.direction === 'incoming' ? 'CUSTOMER' : 'CS';
        const time = m.timestamp.toISOString().split('T')[1].split('.')[0];
        return `[${time}] ${sender}: ${m.body || '[media]'}`;
      })
      .join('\n');

    // Calculate some metrics
    const totalMessages = chatHistory.length;
    const customerMessages = chatHistory.filter(
      (m) => m.direction === 'incoming',
    ).length;

    // Calculate time to close
    let timeInfo = '';
    if (funnel.blastSentAt && funnel.closedAt) {
      const duration =
        (funnel.closedAt.getTime() - funnel.blastSentAt.getTime()) /
        (1000 * 60);
      timeInfo = `Durasi dari blast ke closing: ${this.formatDuration(duration)}`;
    }

    const prompt = `Kamu adalah analis sales conversation. Analisis percakapan WhatsApp berikut dan berikan insight kenapa ${outcomeText}.

INFORMASI:
- Outcome: ${outcomeText}
- Total pesan: ${totalMessages}
- Pesan customer: ${customerMessages}
${funnel.dealValue ? `- Nilai deal: Rp ${funnel.dealValue.toLocaleString('id-ID')}` : ''}
${timeInfo}
${funnel.closedReason ? `- Alasan closing: ${funnel.closedReason}` : ''}

RIWAYAT CHAT:
${historyText}

Berikan analisis dalam format JSON berikut:

${
  isWon
    ? `
{
  "summary": "Ringkasan singkat kenapa berhasil closing (1-2 kalimat)",
  "successFactors": [
    {
      "factor": "nama_faktor (contoh: Fast Response, Promo, Social Proof)",
      "description": "penjelasan singkat",
      "evidence": "bukti dari chat"
    }
  ],
  "improvementAreas": [
    {
      "area": "aspek yang bisa ditingkatkan",
      "suggestion": "saran perbaikan"
    }
  ],
  "keyMoments": [
    {"timestamp": "HH:MM:SS", "event": "momen penting dalam percakapan"}
  ],
  "recommendations": ["saran untuk replika keberhasilan ini"],
  "sentiment": "positive/neutral/negative"
}`
    : `
{
  "summary": "Ringkasan singkat kenapa gagal closing (1-2 kalimat)",
  "failureFactors": [
    {
      "factor": "nama_faktor (contoh: Harga, Slow Response, No Stock)",
      "description": "penjelasan singkat",
      "evidence": "bukti dari chat"
    }
  ],
  "missedOpportunities": ["kesempatan yang terlewat"],
  "keyMoments": [
    {"timestamp": "HH:MM:SS", "event": "momen penting dalam percakapan"}
  ],
  "recommendations": ["saran untuk menghindari kegagalan serupa"],
  "sentiment": "positive/neutral/negative",
  "recoveryChance": "high/medium/low",
  "recoverySuggestion": "saran untuk recovery customer ini"
}`
}

PENTING:
- Berikan analisis yang actionable dan spesifik
- Fokus pada insight yang bisa digunakan untuk perbaikan
- Response HARUS valid JSON tanpa markdown code blocks`;

    return prompt;
  }

  private parseInsightResponse(
    response: string,
    stage: FunnelStage,
  ): AiInsight {
    try {
      // Clean response
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      return {
        summary: parsed.summary || 'Analisis tidak tersedia',
        successFactors: parsed.successFactors || undefined,
        failureFactors: parsed.failureFactors || undefined,
        improvementAreas: parsed.improvementAreas || undefined,
        missedOpportunities: parsed.missedOpportunities || undefined,
        keyMoments:
          parsed.keyMoments?.map((km: any) => ({
            timestamp: new Date(),
            event: km.event,
          })) || undefined,
        recommendations: parsed.recommendations || undefined,
        sentiment: parsed.sentiment || 'neutral',
        recoveryChance: parsed.recoveryChance || undefined,
        recoverySuggestion: parsed.recoverySuggestion || undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to parse AI response: ${response}`);

      // Return fallback insight
      const isWon = stage === FunnelStage.CLOSED_WON;
      return {
        summary: isWon
          ? 'Percakapan berhasil mencapai closing'
          : 'Percakapan tidak berhasil closing',
        sentiment: isWon ? 'positive' : 'negative',
        recommendations: [
          'Analisis detail tidak tersedia, silakan review percakapan secara manual',
        ],
      };
    }
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${Math.round(minutes)} menit`;
    } else if (minutes < 1440) {
      return `${Math.round(minutes / 60)} jam`;
    } else {
      return `${Math.round(minutes / 1440)} hari`;
    }
  }

  private normalizePhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    if (
      cleaned.startsWith('62') &&
      cleaned.length > 13 &&
      cleaned.endsWith('0')
    ) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }
}
