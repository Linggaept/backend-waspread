# API Documentation: Blast Campaign

> **Base URL:** `http://localhost:2004/api`  
> **Authentication:** Bearer Token (JWT)

---

## 📨 Create Campaign

Membuat campaign baru untuk blast message ke banyak nomor WhatsApp.

### Endpoint

```
POST /blasts
```

### Headers

| Header          | Value                                         | Required |
| --------------- | --------------------------------------------- | -------- |
| `Authorization` | `Bearer <JWT_TOKEN>`                          | ✅       |
| `Content-Type`  | `application/json` atau `multipart/form-data` | ✅       |

> **Catatan:** Gunakan `multipart/form-data` jika upload file (CSV/gambar).

---

### Request Body

| Field          | Type     | Required       | Description                                                         |
| -------------- | -------- | -------------- | ------------------------------------------------------------------- |
| `name`         | string   | ✅             | Nama campaign                                                       |
| `message`      | string   | ✅             | Isi pesan / caption gambar                                          |
| `phoneNumbers` | string[] | ⚠️ Kondisional | Array nomor HP. Wajib jika tidak ada `contactTag` atau `phonesFile` |
| `contactTag`   | string   | ⚠️ Kondisional | Tag kontak untuk fetch nomor dari database                          |
| `phonesFile`   | File     | ⚠️ Kondisional | File CSV/Excel berisi nomor HP di kolom pertama                     |
| `imageFile`    | File     | ❌ Optional    | Gambar attachment (JPEG, PNG, GIF, WebP). Max 5MB                   |
| `delayMs`      | number   | ❌ Optional    | Delay antar pesan dalam milidetik. Default: 3000, Min: 1000         |

> **Prioritas sumber nomor HP:**
>
> 1. `phonesFile` (highest)
> 2. `contactTag`
> 3. `phoneNumbers` (lowest)

---

### Request Examples

#### 1. JSON - Manual Phone Numbers

```http
POST /api/blasts
Content-Type: application/json
Authorization: Bearer eyJhbGc...

{
  "name": "Promo January",
  "message": "Halo! Dapatkan diskon 50% hari ini saja. Kunjungi toko kami sekarang!",
  "phoneNumbers": ["628123456789", "628987654321", "628555123456"],
  "delayMs": 5000
}
```

#### 2. JSON - From Contact Tag

```http
POST /api/blasts
Content-Type: application/json
Authorization: Bearer eyJhbGc...

{
  "name": "VIP Customer Notification",
  "message": "Selamat! Anda mendapat voucher spesial sebagai pelanggan VIP kami.",
  "contactTag": "vip-customer",
  "delayMs": 3000
}
```

#### 3. Multipart - Upload CSV + Image

```http
POST /api/blasts
Content-Type: multipart/form-data
Authorization: Bearer eyJhbGc...

------WebKitFormBoundary
Content-Disposition: form-data; name="name"

Promo Produk Baru
------WebKitFormBoundary
Content-Disposition: form-data; name="message"

🔥 Cek produk terbaru kami! Diskon hingga 70%
------WebKitFormBoundary
Content-Disposition: form-data; name="delayMs"

4000
------WebKitFormBoundary
Content-Disposition: form-data; name="phonesFile"; filename="contacts.csv"
Content-Type: text/csv

(binary file data)
------WebKitFormBoundary
Content-Disposition: form-data; name="imageFile"; filename="promo.jpg"
Content-Type: image/jpeg

(binary file data)
------WebKitFormBoundary--
```

---

### JavaScript Implementation

#### Option A: JSON Body (Manual Numbers / Contact Tag)

```javascript
const createCampaign = async (data) => {
  const response = await fetch('http://localhost:2004/api/blasts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: data.name,
      message: data.message,
      contactTag: data.contactTag, // OR
      phoneNumbers: data.phoneNumbers, // OR
      delayMs: data.delayMs || 3000,
    }),
  });

  return response.json();
};
```

#### Option B: FormData (With File Upload)

```javascript
const createCampaignWithFiles = async (data, phonesFile, imageFile) => {
  const formData = new FormData();

  // Required fields
  formData.append('name', data.name);
  formData.append('message', data.message);

  // Phone source (choose one)
  if (phonesFile) {
    formData.append('phonesFile', phonesFile);
  } else if (data.contactTag) {
    formData.append('contactTag', data.contactTag);
  } else if (data.phoneNumbers?.length > 0) {
    formData.append('phoneNumbers', JSON.stringify(data.phoneNumbers));
  }

  // Optional fields
  if (data.delayMs) {
    formData.append('delayMs', data.delayMs.toString());
  }
  if (imageFile) {
    formData.append('imageFile', imageFile);
  }

  const response = await fetch('http://localhost:2004/api/blasts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      // DO NOT set Content-Type, browser will set it automatically with boundary
    },
    body: formData,
  });

  return response.json();
};
```

---

### Success Response (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Promo January",
    "message": "Halo! Dapatkan diskon 50% hari ini saja.",
    "status": "draft",
    "totalRecipients": 150,
    "sentCount": 0,
    "failedCount": 0,
    "pendingCount": 150,
    "delayMs": 5000,
    "imageUrl": "/uploads/user-uuid/images/promo-1706789234.jpg",
    "startedAt": null,
    "completedAt": null,
    "createdAt": "2026-02-01T06:30:00.000Z"
  },
  "timestamp": "2026-02-01T06:30:00.000Z"
}
```

---

### Error Responses

#### 400 Bad Request - Missing Phone Numbers

```json
{
  "success": false,
  "message": "Phone numbers are required. Provide phoneNumbers array, upload a phonesFile, or specify a contactTag.",
  "error": {
    "code": "BAD_REQUEST"
  },
  "timestamp": "2026-02-01T06:30:00.000Z"
}
```

#### 400 Bad Request - Invalid File Format

```json
{
  "success": false,
  "message": "Invalid file format. Supported formats: CSV, XLS, XLSX",
  "error": {
    "code": "BAD_REQUEST"
  }
}
```

#### 400 Bad Request - Image Too Large

```json
{
  "success": false,
  "message": "Image file too large. Maximum size: 5MB",
  "error": {
    "code": "BAD_REQUEST"
  }
}
```

#### 401 Unauthorized

```json
{
  "success": false,
  "message": "Unauthorized",
  "error": {
    "code": "UNAUTHORIZED"
  }
}
```

#### 403 Quota Exceeded

```json
{
  "success": false,
  "message": "Monthly quota exceeded. Please upgrade your plan.",
  "error": {
    "code": "FORBIDDEN"
  }
}
```

---

## 🚀 Start Campaign

Setelah campaign dibuat (status: `draft`), jalankan dengan endpoint ini.

### Endpoint

```
POST /blasts/{id}/start
```

### Request

```http
POST /api/blasts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/start
Authorization: Bearer eyJhbGc...
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "running",
    "message": "Blast started successfully"
  }
}
```

---

## ❌ Cancel Campaign

Batalkan campaign yang sedang berjalan.

### Endpoint

```
POST /blasts/{id}/cancel
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "cancelled",
    "message": "Blast cancelled"
  }
}
```

---

## 📋 Campaign Status Flow

```
draft → running → completed
          ↓
       cancelled
          ↓
        failed
```

| Status      | Description                        |
| ----------- | ---------------------------------- |
| `draft`     | Campaign dibuat, belum dijalankan  |
| `running`   | Sedang mengirim pesan              |
| `completed` | Semua pesan sudah terkirim         |
| `cancelled` | Dibatalkan oleh user               |
| `failed`    | Gagal (WhatsApp disconnected, dll) |

---

## 📊 Get Campaign List

### Endpoint

```
GET /blasts
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "name": "Promo January",
      "status": "completed",
      "totalRecipients": 150,
      "sentCount": 148,
      "failedCount": 2,
      "createdAt": "2026-02-01T06:30:00.000Z"
    },
    {
      "id": "uuid-2",
      "name": "VIP Notification",
      "status": "draft",
      "totalRecipients": 50,
      "sentCount": 0,
      "failedCount": 0,
      "createdAt": "2026-02-01T07:00:00.000Z"
    }
  ]
}
```

---

## 🔍 Get Campaign Detail with Messages

### Endpoint

```
GET /blasts/{id}/messages
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid-1",
    "name": "Promo January",
    "message": "Halo! Dapatkan diskon 50%",
    "status": "completed",
    "totalRecipients": 3,
    "sentCount": 2,
    "failedCount": 1,
    "messages": [
      {
        "id": "msg-1",
        "phoneNumber": "628123456789",
        "status": "sent",
        "sentAt": "2026-02-01T06:31:00.000Z",
        "errorMessage": null
      },
      {
        "id": "msg-2",
        "phoneNumber": "628987654321",
        "status": "sent",
        "sentAt": "2026-02-01T06:31:05.000Z",
        "errorMessage": null
      },
      {
        "id": "msg-3",
        "phoneNumber": "628555123456",
        "status": "failed",
        "sentAt": null,
        "errorMessage": "Number not registered on WhatsApp"
      }
    ]
  }
}
```

---

## 📈 Get Campaign Statistics

### Endpoint

```
GET /blasts/stats
```

### Response

```json
{
  "success": true,
  "data": {
    "totalCampaigns": 25,
    "totalMessagesSent": 1500,
    "totalMessagesFailed": 45,
    "successRate": 97.08
  }
}
```

---

## 📁 CSV File Format

File CSV/Excel harus memiliki nomor HP di **kolom pertama**. Header opsional.

**Contoh `contacts.csv`:**

```csv
phone
628123456789
628987654321
08555123456
+62 812-3456-7890
```

> **Catatan:** Sistem akan otomatis:
>
> - Menghapus karakter non-digit
> - Mengkonversi `08...` menjadi `628...`
> - Menghapus tanda `+`

---

## 🖼️ Supported Image Formats

| Format | MIME Type  | Max Size |
| ------ | ---------- | -------- |
| JPEG   | image/jpeg | 5MB      |
| PNG    | image/png  | 5MB      |
| GIF    | image/gif  | 5MB      |
| WebP   | image/webp | 5MB      |

---

## 📡 WebSocket Events (Real-time Updates)

Connect ke WebSocket untuk mendapat update real-time:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:2004/whatsapp');

// Subscribe setelah login
socket.emit('subscribe', { userId: 'user-uuid-from-jwt' });

// Listen blast progress
socket.on('message-status', (data) => {
  console.log(`Message ${data.messageId}: ${data.status}`);
  // Update UI progress bar
});
```

---

## ⚠️ Rate Limiting & Quotas

- **Minimum Delay:** 1000ms (1 detik) antar pesan
- **Recommended Delay:** 3000-5000ms untuk menghindari ban WhatsApp
- **Monthly Quota:** Tergantung paket langganan user
- **Daily Limit:** Tergantung paket langganan user

---

## 🔗 Related Endpoints

| Endpoint                          | Method | Description                |
| --------------------------------- | ------ | -------------------------- |
| `/contacts`                       | GET    | List saved contacts        |
| `/contacts/tags`                  | GET    | Get available contact tags |
| `/contacts/phone-numbers?tag=xxx` | GET    | Get phone numbers by tag   |
| `/whatsapp/status`                | GET    | Check WA connection status |
| `/whatsapp/connect`               | POST   | Connect WhatsApp session   |

---

**Swagger Documentation:** `http://localhost:2004/docs`
