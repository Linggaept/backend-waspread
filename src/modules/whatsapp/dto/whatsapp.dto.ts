export class SessionStatusDto {
  userId: string;
  status: string;
  phoneNumber?: string;
  pushName?: string;
  qrCode?: string;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  disconnectReason?: string;
}

export class SendMessageDto {
  phoneNumber: string;
  message: string;
}

export class SendBulkMessageDto {
  phoneNumbers: string[];
  message: string;
  delayMs?: number;
}
