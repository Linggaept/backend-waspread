import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  GenerateCopyDto,
  GenerateCopyResponseDto,
  CopywritingTone,
} from './dto';

@Injectable()
export class CopywritingService implements OnModuleInit {
  private readonly logger = new Logger(CopywritingService.name);
  private model: GenerativeModel | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    if (apiKey) {
      const modelName =
        this.configService.get<string>('gemini.model') || 'gemini-2.0-flash';
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: modelName });
      this.logger.log(`Gemini AI initialized with model: ${modelName}`);
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not configured. Copywriting endpoint will return 400.',
      );
    }
  }

  async generateCopy(dto: GenerateCopyDto): Promise<GenerateCopyResponseDto> {
    if (!this.model) {
      throw new BadRequestException(
        'Gemini AI is not configured. Please set GEMINI_API_KEY environment variable.',
      );
    }

    const {
      prompt,
      variations = 3,
      tone = CopywritingTone.FRIENDLY,
      includeEmojis = true,
      language = 'id',
    } = dto;

    const systemPrompt = this.buildSystemPrompt(
      variations,
      tone,
      includeEmojis,
      language,
    );

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { role: 'model', parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2048,
        },
      });

      const responseText = result.response.text();
      const messages = this.parseResponse(responseText, variations);

      return {
        variations: messages.map((message) => ({
          message,
          characterCount: message.length,
        })),
        prompt,
        tone,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Gemini API error: ${message}`, stack);
      throw new BadRequestException(
        'Failed to generate copywriting. Please try again.',
      );
    }
  }

  private buildSystemPrompt(
    variations: number,
    tone: CopywritingTone,
    includeEmojis: boolean,
    language: string,
  ): string {
    const toneInstructions: Record<CopywritingTone, string> = {
      [CopywritingTone.FRIENDLY]:
        'Gunakan nada ramah, hangat, dan bersahabat seperti berbicara dengan teman.',
      [CopywritingTone.URGENT]:
        'Gunakan nada mendesak, ciptakan FOMO, tekankan kelangkaan dan batas waktu.',
      [CopywritingTone.PROFESSIONAL]:
        'Gunakan nada profesional, formal namun tetap menarik dan persuasif.',
      [CopywritingTone.CASUAL]:
        'Gunakan nada santai, gaul, dan natural seperti chat sehari-hari.',
      [CopywritingTone.EXCITED]:
        'Gunakan nada antusias, semangat, dan penuh energi positif.',
    };

    const languageMap: Record<string, string> = {
      id: 'Bahasa Indonesia',
      en: 'English',
    };
    const languageName = languageMap[language] || language;

    return `Kamu adalah copywriter WhatsApp marketing profesional.

TUGAS: Buat ${variations} variasi pesan marketing WhatsApp berdasarkan prompt dari user.

ATURAN:
1. Tulis dalam bahasa: ${languageName}
2. Tone: ${toneInstructions[tone]}
3. ${includeEmojis ? 'Sertakan emoji yang relevan untuk meningkatkan engagement.' : 'JANGAN gunakan emoji sama sekali.'}
4. Setiap variasi HARUS berbeda: beda pembukaan, struktur kalimat, dan teknik persuasi.
5. Gunakan teknik persuasi yang berbeda per variasi: scarcity, social proof, benefit-focused, emotional appeal, curiosity.
6. Panjang setiap pesan: 50-300 karakter.
7. JANGAN gunakan markdown, hashtag, atau greeting formal (Dear, Yth).
8. Pesan harus langsung to-the-point dan cocok untuk WhatsApp blast.
9. Setiap variasi harus bisa berdiri sendiri sebagai pesan lengkap.

FORMAT OUTPUT: Respond HANYA dengan JSON array of strings. Contoh:
["pesan variasi 1", "pesan variasi 2", "pesan variasi 3"]

JANGAN tambahkan penjelasan, komentar, atau teks apapun di luar JSON array.`;
  }

  private parseResponse(responseText: string, expectedCount: number): string[] {
    // Primary: try parsing as JSON array
    try {
      const trimmed = responseText.trim();
      // Handle markdown code blocks
      const jsonStr = trimmed
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?\s*```$/i, '')
        .trim();
      const parsed: unknown = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as unknown[])
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .slice(0, expectedCount);
      }
    } catch {
      // Fall through to fallback parser
    }

    // Fallback: split by newlines and clean up
    this.logger.warn(
      'Gemini response was not valid JSON, using fallback parser',
    );
    const lines = responseText
      .split('\n')
      .map((line) =>
        line
          .replace(/^\d+[.)]\s*/, '')
          .replace(/^[-*]\s*/, '')
          .trim(),
      )
      .filter(
        (line) =>
          line.length >= 20 && !line.startsWith('{') && !line.startsWith('['),
      );

    if (lines.length > 0) {
      return lines.slice(0, expectedCount);
    }

    throw new Error('Could not parse Gemini response into valid messages');
  }
}
