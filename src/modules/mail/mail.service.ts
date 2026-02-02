import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendPasswordResetCode(
    email: string,
    code: string,
    name?: string,
  ): Promise<boolean> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Reset Password - Waspread',
        html: this.getPasswordResetTemplate(code, name),
      });

      this.logger.log(`Password reset code sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error);
      return false;
    }
  }

  private getPasswordResetTemplate(code: string, name?: string): string {
    const displayName = name || 'User';
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 10px; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { font-size: 28px; font-weight: bold; color: #22c55e; }
    .code-box { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px 40px; border-radius: 10px; text-align: center; margin: 30px 0; }
    .message { color: #666; line-height: 1.6; text-align: center; }
    .warning { color: #f59e0b; font-size: 14px; margin-top: 20px; text-align: center; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo">🚀 Waspread</div>
      </div>
      
      <p class="message">Halo <strong>${displayName}</strong>,</p>
      <p class="message">Kami menerima permintaan untuk reset password akun Anda. Gunakan kode berikut untuk melanjutkan:</p>
      
      <div class="code-box">${code}</div>
      
      <p class="message">Masukkan kode ini di halaman reset password.</p>
      
      <p class="warning">⚠️ Kode ini berlaku selama 15 menit. Jika Anda tidak meminta reset password, abaikan email ini.</p>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} Waspread. All rights reserved.</p>
        <p>Jangan bagikan kode ini kepada siapapun.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }
}
