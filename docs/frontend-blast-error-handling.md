# Frontend Integration Guide: Blast Error Handling & WebSocket Updates

## Overview

Update terbaru menambahkan:

1. **Validasi nomor WhatsApp** sebelum kirim pesan
2. **Status baru `INVALID_NUMBER`** untuk nomor tidak terdaftar
3. **Error type categorization** untuk filtering
4. **WebSocket events** dengan data `invalid` count

---

## 1. Message Status Updates

### Enum: MessageStatus

```typescript
enum MessageStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  INVALID_NUMBER = 'invalid_number', // NEW!
}
```

### Enum: MessageErrorType

```typescript
enum MessageErrorType {
  NONE = 'none',
  INVALID_NUMBER = 'invalid_number',
  NETWORK_ERROR = 'network_error',
  SESSION_ERROR = 'session_error',
  RATE_LIMITED = 'rate_limited',
  UNKNOWN = 'unknown',
}
```

---

## 2. API Response Updates

### GET /api/blasts/:id

Response sekarang include `invalidCount`:

```json
{
  "id": "uuid",
  "name": "Campaign Name",
  "status": "completed",
  "totalRecipients": 100,
  "sentCount": 85,
  "failedCount": 5,
  "invalidCount": 10,  // NEW!
  "pendingCount": 0,
  ...
}
```

### GET /api/blasts/:id/messages

Response per message sekarang include `errorType`:

```json
{
  "id": "uuid",
  "phoneNumber": "628123456789",
  "status": "invalid_number",  // or "sent", "failed", etc.
  "errorType": "invalid_number",  // NEW!
  "errorMessage": "Number not registered on WhatsApp",
  "retryCount": 0,
  ...
}
```

---

## 3. WebSocket Events

Connect ke namespace: `ws://localhost:2004/whatsapp`

### Event: `blast-progress`

Dikirim setiap 5 pesan terproses.

```typescript
interface BlastProgress {
  blastId: string;
  sent: number;
  failed: number;
  invalid: number; // NEW!
  pending: number;
  total: number;
  percentage: number;
}
```

**Example:**

```json
{
  "blastId": "123-456-789",
  "sent": 45,
  "failed": 3,
  "invalid": 2,
  "pending": 50,
  "total": 100,
  "percentage": 50
}
```

### Event: `blast-completed`

Dikirim saat blast selesai.

```typescript
interface BlastCompleted {
  blastId: string;
  status: 'completed' | 'failed';
  sent: number;
  failed: number;
  invalid: number; // NEW!
  duration: number; // in seconds
}
```

**Example:**

```json
{
  "blastId": "123-456-789",
  "status": "completed",
  "sent": 85,
  "failed": 5,
  "invalid": 10,
  "duration": 120
}
```

---

## 4. UI Recommendations

### Progress Bar

Tampilkan 3 kategori:

- 🟢 **Sent** - Berhasil terkirim
- 🔴 **Failed** - Gagal setelah retry
- 🟠 **Invalid** - Nomor tidak terdaftar (skip tanpa retry)

```
[███████████████░░░░░░░░░░] 60%
Sent: 45 | Failed: 3 | Invalid: 2 | Pending: 50
```

### Message Status Badge

| Status           | Color  | Label           |
| ---------------- | ------ | --------------- |
| `sent`           | Green  | ✓ Terkirim      |
| `failed`         | Red    | ✕ Gagal         |
| `invalid_number` | Orange | ⚠ Nomor Invalid |
| `pending`        | Gray   | ○ Menunggu      |
| `queued`         | Blue   | ◐ Dalam Antrian |
| `cancelled`      | Gray   | ⊘ Dibatalkan    |

### Error Filter

Bisa filter messages by `errorType`:

- `invalid_number` - Nomor tidak terdaftar WA
- `network_error` - Masalah koneksi
- `session_error` - Session WA putus
- `rate_limited` - Kena limit WhatsApp
- `unknown` - Error lainnya

---

## 5. WebSocket Connection Example

```typescript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:2004/whatsapp', {
  auth: { token: 'user-jwt-token' },
});

// Subscribe to user's room
socket.emit('subscribe', { userId: 'user-uuid' });

// Listen for blast progress
socket.on('blast-progress', (data) => {
  console.log(`Progress: ${data.percentage}%`);
  console.log(
    `Sent: ${data.sent}, Failed: ${data.failed}, Invalid: ${data.invalid}`,
  );

  // Update progress bar
  updateProgressBar(data);
});

// Listen for blast completed
socket.on('blast-completed', (data) => {
  console.log(`Blast completed: ${data.status}`);
  console.log(`Duration: ${data.duration}s`);

  // Show completion modal
  showCompletionSummary(data);
});
```

---

## 6. Summary Statistics Card

Untuk dashboard, tampilkan summary:

```
┌────────────────────────────────────┐
│         Campaign: Promo Jan        │
├────────────────────────────────────┤
│  Total Recipients    100           │
│  ✓ Sent              85  (85%)     │
│  ✕ Failed             5  (5%)      │
│  ⚠ Invalid           10  (10%)     │
│  Duration          2m 30s          │
└────────────────────────────────────┘
```

---

## Questions?

Hubungi backend team jika ada pertanyaan!
